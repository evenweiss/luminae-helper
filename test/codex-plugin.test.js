import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const native = vi.hoisted(() => ({ run: vi.fn(), home: "" }));
vi.mock("node:os", async original => ({ ...await original(), homedir: () => native.home }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: native.run }),
}));
const { installPlugin, listInstalledPlugins, listManagedPlugins, readLocalPluginSource, runPluginCommand, uninstallPlugin }
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

// ── 目录宿主：Cursor / Hermes Agent / Pi ──

it("lists the managed plugin for every plugin host", () => {
  for (const host of ["cursor", "hermes-agent", "pi"]) {
    expect(listManagedPlugins(host).map(plugin => plugin.name)).toEqual(["ai-development-workflow"]);
  }
});

it("reads a standalone Cursor plugin directory", () => {
  const dir = join(root, "cursor-plugin");
  put(join(dir, ".cursor-plugin/plugin.json"), { name: "workflow", version: "1.2.3" });
  expect(readLocalPluginSource(dir, "cursor").plugins).toEqual([
    { name: "workflow", version: "1.2.3", dir: realpathSync(dir) },
  ]);
});

it("installs a managed plugin for Cursor into its local plugin directory", async () => {
  await expect(installPlugin("ai-development-workflow", undefined, "cursor"))
    .resolves.toMatchObject({ pluginId: "ai-development-workflow", version: "0.10.2" });
  const dest = join(native.home, ".cursor/plugins/local/ai-development-workflow");
  expect(existsSync(join(dest, ".cursor-plugin/plugin.json"))).toBe(true);
  expect(existsSync(join(dest, "skills/ai-development-workflow/SKILL.md"))).toBe(true);
  expect(existsSync(join(dest, "hooks/cursor.json"))).toBe(true);
  expect(native.run).not.toHaveBeenCalled();
});

it("refuses to overwrite a Cursor plugin it does not manage", async () => {
  mkdirSync(join(native.home, ".cursor/plugins/local/ai-development-workflow"), { recursive: true });
  await expect(installPlugin("ai-development-workflow", undefined, "cursor")).rejects.toThrow("不属于 Luminae Helper");
});

it("installs and enables a managed plugin for Hermes Agent", async () => {
  native.run.mockImplementation(async (_, args) => {
    if (args[1] === "enable") return { stdout: "" };
    if (args[1] === "show") return { stdout: "ai-development-workflow v0.10.2\nStatus: enabled\n" };
    throw new Error(`unexpected ${args.join(" ")}`);
  });
  await expect(installPlugin("ai-development-workflow", undefined, "hermes-agent"))
    .resolves.toMatchObject({ pluginId: "ai-development-workflow" });
  expect(existsSync(join(native.home, ".hermes/plugins/ai-development-workflow/plugin.yaml"))).toBe(true);
  expect(native.run.mock.calls.map(([, args]) => args)).toEqual([
    ["plugins", "enable", "ai-development-workflow"],
    ["plugins", "show", "ai-development-workflow"],
  ]);
});

it("reports a Hermes plugin that did not enable", async () => {
  native.run.mockImplementation(async (_, args) => ({ stdout: args[1] === "show" ? "Status: disabled" : "" }));
  await expect(installPlugin("ai-development-workflow", undefined, "hermes-agent")).rejects.toThrow("未确认启用");
});

it("installs a managed package for Pi and verifies the settings entry", async () => {
  const agentDir = join(native.home, ".pi/agent");
  const dest = join(native.home, ".local/share/luminae-helper/pi-packages/ai-development-workflow");
  native.run.mockImplementation(async (_, args) => {
    expect(args).toEqual(["install", dest]);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
      packages: ["../../.local/share/luminae-helper/pi-packages/ai-development-workflow"],
    }));
    return { stdout: "" };
  });
  await expect(installPlugin("ai-development-workflow", undefined, "pi"))
    .resolves.toMatchObject({ pluginId: "ai-development-workflow", version: "0.10.2" });
  expect(existsSync(join(dest, "package.json"))).toBe(true);
});

it("reports a Pi package missing from Pi settings", async () => {
  mkdirSync(join(native.home, ".pi/agent"), { recursive: true });
  writeFileSync(join(native.home, ".pi/agent/settings.json"), JSON.stringify({ packages: [] }));
  native.run.mockResolvedValueOnce({ stdout: "" });
  await expect(installPlugin("ai-development-workflow", undefined, "pi")).rejects.toThrow("未登记");
});

// ── 插件卸载 ──

it("lists and removes a Codex plugin from the helper marketplace", async () => {
  const config = join(native.home, ".codex", "config.toml");
  put(join(native.home, ".codex/config.toml"), {});
  writeFileSync(config, '[plugins."workflow@luminae-helper"]\nenabled = true\n\n[plugins."other@official"]\nenabled = true\n');
  expect(listInstalledPlugins("codex")).toEqual([{ name: "workflow" }]);
  native.run.mockImplementation(async (_, args) => {
    expect(args).toEqual(["plugin", "remove", "workflow@luminae-helper", "--json"]);
    writeFileSync(config, '[plugins."other@official"]\nenabled = true\n');
    return { stdout: "{}" };
  });
  await expect(uninstallPlugin("workflow", "codex")).resolves.toMatchObject({ pluginId: "workflow" });
  expect(listInstalledPlugins("codex")).toEqual([]);
});

it("lists and removes a Claude Code plugin from the helper marketplace", async () => {
  const file = join(native.home, ".claude/plugins/installed_plugins.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ plugins: { "workflow@luminae-helper": [{}], "other@official": [{}] } }));
  expect(listInstalledPlugins("claude-code")).toEqual([{ name: "workflow" }]);
  native.run.mockImplementation(async (_, args) => {
    expect(args).toEqual(["plugin", "uninstall", "workflow@luminae-helper", "--scope", "user", "--json"]);
    writeFileSync(file, JSON.stringify({ plugins: { "other@official": [{}] } }));
    return { stdout: "{}" };
  });
  await expect(uninstallPlugin("workflow", "claude-code")).resolves.toMatchObject({ pluginId: "workflow" });
});

it("removes a Cursor plugin only when the Helper marker is present", async () => {
  const foreign = join(native.home, ".cursor/plugins/local/foreign");
  mkdirSync(foreign, { recursive: true });
  const owned = join(native.home, ".cursor/plugins/local/workflow");
  mkdirSync(owned, { recursive: true });
  writeFileSync(join(owned, ".luminae-helper-plugin"), "luminae-helper");
  expect(listInstalledPlugins("cursor")).toEqual([{ name: "workflow" }]);
  await uninstallPlugin("workflow", "cursor");
  expect(existsSync(owned)).toBe(false);
  expect(existsSync(foreign)).toBe(true);
  await expect(uninstallPlugin("foreign", "cursor")).rejects.toThrow("没有 Helper 管理的插件");
});

it("removes a Hermes Agent plugin through its CLI", async () => {
  const dir = join(native.home, ".hermes/plugins/workflow");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".luminae-helper-plugin"), "luminae-helper");
  native.run.mockImplementation(async (_, args) => {
    expect(args).toEqual(["plugins", "remove", "workflow"]);
    rmSync(dir, { recursive: true, force: true });
    return { stdout: "" };
  });
  await expect(uninstallPlugin("workflow", "hermes-agent")).resolves.toMatchObject({ pluginId: "workflow" });
  expect(existsSync(dir)).toBe(false);
});

it("unregisters and deletes a Pi plugin package", async () => {
  const dir = join(native.home, ".local/share/luminae-helper/pi-packages/workflow");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".luminae-helper-plugin"), "luminae-helper");
  native.run.mockImplementation(async (_, args) => {
    expect(args).toEqual(["remove", dir]);
    return { stdout: "" };
  });
  await expect(uninstallPlugin("workflow", "pi")).resolves.toMatchObject({ pluginId: "workflow" });
  expect(existsSync(dir)).toBe(false);
});

it("rejects an unsupported uninstall host before touching files", async () => {
  await expect(uninstallPlugin("workflow", "opencode")).rejects.toThrow("不支持插件宿主");
  expect(native.run).not.toHaveBeenCalled();
});
