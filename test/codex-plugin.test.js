import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const native = vi.hoisted(() => ({ run: vi.fn(), home: "" }));
vi.mock("node:os", async original => ({ ...await original(), homedir: () => native.home }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: native.run }),
}));
const { installPlugin, listManagedPlugins, readLocalPluginSource, runPluginCommand }
  = await import("../src/lib/codex-plugin.js");

let root, sourceDir;
function put(path, object) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(object));
}
function manifest(name = "local") {
  put(join(sourceDir, ".agents/plugins/marketplace.json"), {
    name, plugins: [
      { name: "workflow", source: { source: "local", path: "./plugins/workflow" } },
      { name: "remote", source: { source: "url", url: "https://example.invalid/plugin" } },
      { name: "outside", source: { source: "local", path: "./../outside" } },
    ],
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  root = realpathSync(mkdtempSync(join(tmpdir(), "plugin source ")));
  native.home = join(root, "home");
  sourceDir = join(root, "local catalog");
  manifest();
  put(join(sourceDir, "plugins/workflow/.codex-plugin/plugin.json"), { name: "workflow", version: "1.2.3" });
  mkdirSync(join(root, "outside"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function reply(value) {
  native.run.mockResolvedValueOnce({ stdout: JSON.stringify(value) });
}

it("lists only bundled plugins without querying Codex's configured marketplaces", () => {
  expect(listManagedPlugins().map(plugin => plugin.name)).toEqual(["ai-development-workflow"]);
  expect(native.run).not.toHaveBeenCalled();
});

it("installs a managed name from the bundled source on a fresh profile", async () => {
  native.run.mockImplementation(async (_, args) => {
    if (args[1] === "marketplace") {
      expect(existsSync(join(args[3], "plugins/ai-development-workflow/hooks/hooks.json"))).toBe(true);
      return { stdout: JSON.stringify({ marketplaceName: "luminae-helper", installedRoot: args[3] }) };
    }
    expect(args).toEqual(["plugin", "add", "ai-development-workflow@luminae-helper", "--json"]);
    return { stdout: JSON.stringify({ pluginId: "ai-development-workflow@luminae-helper" }) };
  });
  await expect(installPlugin("ai-development-workflow")).resolves.toMatchObject({ pluginId: "ai-development-workflow@luminae-helper" });
  expect(native.run).toHaveBeenCalledTimes(2);
});

it("rejects third-party names and qualified selectors without an explicit local package", async () => {
  await expect(installPlugin("workflow")).rejects.toThrow("不在 Helper 的受管清单");
  await expect(runPluginCommand(["install", "workflow@local"])).rejects.toThrow("插件名");
  expect(native.run).not.toHaveBeenCalled();
  expect(existsSync(native.home)).toBe(false);
});

it("installs an unlisted plugin by name from an explicit local catalog", async () => {
  expect(readLocalPluginSource(sourceDir).plugins.map(plugin => plugin.name)).toEqual(["workflow"]);
  reply({ marketplaceName: "local", installedRoot: sourceDir });
  reply({ pluginId: "workflow@local", version: "1.2.3" });
  await expect(installPlugin("workflow", sourceDir)).resolves.toMatchObject({ pluginId: "workflow@local" });
  expect(native.run.mock.calls.map(([, args]) => args)).toEqual([
    ["plugin", "marketplace", "add", sourceDir, "--json"],
    ["plugin", "add", "workflow@local", "--json"],
  ]);
});

it("rejects local catalogs pointing to remote plugins or outside packages", async () => {
  await expect(installPlugin("remote", sourceDir)).rejects.toThrow("remote");
  await expect(installPlugin("outside", sourceDir)).rejects.toThrow("outside");
  manifest("luminae-helper");
  await expect(installPlugin("workflow", sourceDir)).rejects.toThrow("受管来源名称");
  expect(native.run).not.toHaveBeenCalled();
});

it("rejects a same-name marketplace resolved by Codex to another root", async () => {
  reply({ marketplaceName: "local", installedRoot: root });
  await expect(installPlugin("workflow", sourceDir)).rejects.toThrow("未确认来源");
  expect(native.run).toHaveBeenCalledTimes(1);
});

it("accepts a standalone local package via a generated local marketplace", async () => {
  const pkg = join(sourceDir, "plugins/workflow");
  const entry = readLocalPluginSource(pkg);
  native.run.mockImplementation(async (_, args) => {
    if (args[1] === "marketplace") {
      expect(existsSync(join(args[3], "plugins/workflow/.codex-plugin/plugin.json"))).toBe(true);
      return { stdout: JSON.stringify({ marketplaceName: entry.name, installedRoot: args[3] }) };
    }
    expect(args[2]).toBe(`workflow@${entry.name}`);
    return { stdout: JSON.stringify({ pluginId: args[2] }) };
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try { await runPluginCommand(["install", "workflow", "--source", pkg]); }
  finally { log.mockRestore(); }
  expect(native.run).toHaveBeenCalledTimes(2);
});

it("reports an install failure after source registration", async () => {
  reply({ marketplaceName: "local", installedRoot: sourceDir });
  native.run.mockRejectedValueOnce(Object.assign(new Error("exit 1"), { stderr: "plugin not found" }));
  await expect(installPlugin("workflow", sourceDir)).rejects.toThrow(/local[\s\S]*plugin not found/);
});

it("registers and installs for Claude Code with its own CLI and manifest", async () => {
  const plugin = join(sourceDir, "plugins/workflow");
  put(join(plugin, ".claude-plugin/plugin.json"), { name: "workflow", version: "1.2.3" });
  put(join(sourceDir, ".claude-plugin/marketplace.json"), {
    name: "local", owner: { name: "Fixture" }, plugins: [{ name: "workflow", source: "./plugins/workflow" }],
  });
  reply([]);
  reply({ outcome: "ok", marketplace: "local" });
  reply([{ name: "local", source: "directory", path: sourceDir }]);
  reply({ outcome: "ok", pluginId: "workflow@local" });
  await expect(installPlugin("workflow", sourceDir, "claude-code")).resolves.toEqual({ pluginId: "workflow@local", version: "1.2.3" });
  expect(native.run.mock.calls.map(([bin, args]) => [bin, ...args])).toEqual([
    ["claude", "plugin", "marketplace", "list", "--json"],
    ["claude", "plugin", "marketplace", "add", sourceDir, "--scope", "user", "--json"],
    ["claude", "plugin", "marketplace", "list", "--json"],
    ["claude", "plugin", "install", "workflow@local", "--scope", "user", "--json"],
  ]);
});

it("does not repoint an existing Claude Code marketplace", async () => {
  reply([{ name: "local", source: "directory", path: root }]);
  put(join(sourceDir, "plugins/workflow/.claude-plugin/plugin.json"), { name: "workflow" });
  put(join(sourceDir, ".claude-plugin/marketplace.json"), {
    name: "local", owner: { name: "Fixture" }, plugins: [{ name: "workflow", source: "./plugins/workflow" }],
  });
  await expect(installPlugin("workflow", sourceDir, "claude-code")).rejects.toThrow("已指向其他位置");
  expect(native.run.mock.calls.map(([, args]) => args)).toEqual([["plugin", "marketplace", "list", "--json"]]);
});

it("rejects duplicate or unsupported tool options before invoking any host", async () => {
  await expect(runPluginCommand(["install", "workflow", "--tool", "codex", "--tool", "claude-code"])).rejects.toThrow("用法");
  await expect(runPluginCommand(["install", "workflow", "--tool", "unknown"])).rejects.toThrow("不支持插件宿主");
  expect(native.run).not.toHaveBeenCalled();
});
