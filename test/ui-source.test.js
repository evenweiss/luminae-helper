import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const prompts = vi.hoisted(() => ({ select: vi.fn(), input: vi.fn(), checkbox: vi.fn() }));
const plugins = vi.hoisted(() => ({ PLUGIN_HOSTS: ["codex", "claude-code"], listAllManagedPlugins: vi.fn(), listInstalledPlugins: vi.fn(), installPlugin: vi.fn(), uninstallPlugin: vi.fn(), pluginHostNote: vi.fn(() => ""), printPluginResult: vi.fn() }));
vi.mock("../src/lib/codex-plugin.js", () => plugins);
const source = vi.hoisted(() => ({ refreshPublicSource: vi.fn(), acquireCachedSource: vi.fn(), remotePublicTag: vi.fn(), publicSourceOptions: () => ({}) }));
const inventory = vi.hoisted(() => ({ collectInstalled: vi.fn() }));
vi.mock("@inquirer/prompts", () => ({ select: prompts.select, input: prompts.input, Separator: class {} }));
vi.mock("../src/lib/checkbox-with-action-rows.js", () => ({ default: prompts.checkbox }));
vi.mock("../src/lib/public-source.js", () => source);
vi.mock("../src/lib/inventory.js", () => inventory);
vi.mock("../src/utils/platform.js", () => ({ commandExists: () => true }));
const root = mkdtempSync(join(tmpdir(), "ui-source-"));
process.env.HOME = join(root, "home");
mkdirSync(join(root, "skills", "runtime"), { recursive: true });
writeFileSync(join(root, "skills/runtime/SKILL.md"), "---\nname: runtime\ndescription: test\n---\nbody");
const { runInteractive } = await import("../src/lib/ui.js");
const { SKILLS } = await import("../src/lib/constants.js");
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "clear").mockImplementation(() => {});
  prompts.input.mockResolvedValue(""); prompts.checkbox.mockResolvedValue(["__back__"]);
  inventory.collectInstalled.mockReturnValue({ rows: [], source: null });
  source.remotePublicTag.mockResolvedValue("0.1.0");
  SKILLS.splice(0);
});
it("loads runtime skills before offering the install list", async () => {
  source.refreshPublicSource.mockResolvedValue({ root, tag: "0.3.0", commit: "abc" });
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("skill").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(SKILLS.map(s => s.id)).toEqual(["runtime"]);
  const selection = prompts.checkbox.mock.calls[0][0];
  expect(selection.choices.some(choice => choice.value === "__next__")).toBe(true);
  expect(console.log.mock.calls.flat().join("\n")).not.toMatch(/正在获取技能与插件|已获取技能与插件/);
});

it("lists the selected tool and skill in the install preview", async () => {
  const snapshot = { root, tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  prompts.checkbox.mockResolvedValueOnce(["runtime"]).mockResolvedValueOnce(["codex"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("skill").mockResolvedValueOnce("exit");
  await runInteractive();
  const output = console.log.mock.calls.flat().join("\n");
  expect(output).toContain("待安装内容");
  expect(output).toContain("Codex");
  expect(output).toContain("runtime");
});

it("keeps select options flush with the title bar", async () => {
  prompts.select.mockResolvedValueOnce("exit");
  await runInteractive();
  const menu = prompts.select.mock.calls[0][0];
  expect(menu.choices.slice(0, 4).every(choice => !choice.name.startsWith(" "))).toBe(true);
  expect(menu.theme.prefix).toContain("▌");
});

it("reuses the startup inventory when entering the installed view", async () => {
  prompts.select.mockResolvedValueOnce("list").mockResolvedValueOnce("list").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(inventory.collectInstalled).toHaveBeenCalledTimes(1);
});

it("rescans after an install, then reuses the result for the installed view", async () => {
  const snapshot = { root: "/fixture/snapshot", tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  plugins.listAllManagedPlugins.mockReturnValue([{ name: "workflow", hosts: ["codex"] }]);
  plugins.installPlugin.mockResolvedValue({ pluginId: "workflow@luminae-helper", version: "1.2.3" });
  prompts.checkbox.mockResolvedValueOnce(["workflow"]).mockResolvedValueOnce(["codex"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm").mockResolvedValueOnce("list").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(inventory.collectInstalled).toHaveBeenCalledTimes(2);
});

it("rescans installed content even when the install fails", async () => {
  const snapshot = { root: "/fixture/snapshot", tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  plugins.listAllManagedPlugins.mockReturnValue([{ name: "workflow", hosts: ["codex"] }]);
  plugins.installPlugin.mockRejectedValue(new Error("boom"));
  prompts.checkbox.mockResolvedValueOnce(["workflow"]).mockResolvedValueOnce(["codex"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(inventory.collectInstalled).toHaveBeenCalledTimes(2);
});

it("shows a startup check failure without blocking the menu", async () => {
  source.remotePublicTag.mockRejectedValue(new Error("网络不可用"));
  prompts.select.mockResolvedValueOnce("exit");
  await runInteractive();
  const output = console.log.mock.calls.map(([line]) => String(line)).join("\n");
  expect(output).toContain("无法检查更新：网络不可用，安装时会重试");
});

it("starts the uninstall skill list with nothing selected", async () => {
  const directory = join(root, "home/.codex/skills/runtime");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), "---\nname: runtime\nmanaged-by: luminae-helper\n---\nbody");
  prompts.select.mockResolvedValueOnce("uninstall").mockResolvedValueOnce("skill").mockResolvedValueOnce("exit");
  await runInteractive();
  const call = prompts.checkbox.mock.calls.find(([config]) => config.message === "选择技能:");
  expect(call).toBeTruthy();
  const selectable = call[0].choices.filter(choice => typeof choice.value === "string" && !choice.value.startsWith("__"));
  expect(selectable.length).toBeGreaterThan(0);
  expect(selectable.every(choice => choice.checked === false)).toBe(true);
});
it("labels uninstall combinations missing on a tool as 未安装", async () => {
  for (const id of ["matrix-a", "matrix-b"]) {
    const directory = join(root, `home/.codex/skills/${id}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "SKILL.md"), `---\nname: ${id}\nmanaged-by: luminae-helper\n---\nbody`);
  }
  prompts.checkbox.mockResolvedValueOnce(["dir:matrix-a", "dir:matrix-b"]).mockResolvedValueOnce(["codex", "cursor"]);
  prompts.select.mockResolvedValueOnce("uninstall").mockResolvedValueOnce("skill")
    .mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  const output = console.log.mock.calls.flat().join("\n");
  expect(output).toContain("待卸载");
  expect(output).toContain("未安装");
  expect(output.indexOf("已安装的受管内容（离线卸载）")).toBeLessThan(output.indexOf("执行中"));
  expect(output).not.toContain("不支持");
  expect(output).not.toContain("不适用");
});

it("does not enter execution when every uninstall row is missing", async () => {
  const directory = join(root, "home/.codex/skills/empty-a");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), "---\nname: empty-a\nmanaged-by: luminae-helper\n---\nbody");
  prompts.checkbox.mockResolvedValueOnce(["dir:empty-a"]).mockResolvedValueOnce(["cursor"])
    .mockResolvedValueOnce(["__back__"]).mockResolvedValueOnce(["__back__"]);
  prompts.select.mockResolvedValueOnce("uninstall").mockResolvedValueOnce("skill").mockResolvedValueOnce("exit");
  await runInteractive();
  const output = console.log.mock.calls.flat().join("\n");
  expect(output).toContain("没有需要卸载的内容（1 项未安装）");
  expect(output).not.toContain("执行中");
});

it.each([false, true])("only loads stale cache after explicit consent=%s", async (consent) => {
  source.refreshPublicSource.mockRejectedValue(new Error("offline"));
  source.acquireCachedSource.mockReturnValue({ root, tag: "0.2.0", commit: "old" });
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("skill").mockResolvedValueOnce(consent ? "cache" : "back").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(SKILLS.map(s => s.id)).toEqual(consent ? ["runtime"] : []);
});
it("first download failure returns without an install list", async () => {
  source.refreshPublicSource.mockRejectedValue(new Error("offline")); source.acquireCachedSource.mockReturnValue(null);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("skill").mockResolvedValueOnce("exit");
  await runInteractive(); expect(SKILLS).toEqual([]);
});
it("uninstall needs neither remote source nor cache", async () => {
  source.refreshPublicSource.mockRejectedValue(new Error("must not fetch"));
  prompts.select.mockResolvedValueOnce("uninstall").mockResolvedValueOnce("skill").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(source.refreshPublicSource).not.toHaveBeenCalled(); expect(source.acquireCachedSource).not.toHaveBeenCalled();
});

it.each(["back", "throw"])("releases the source when install selection ends via %s", async (action) => {
  const release = vi.fn().mockResolvedValue(undefined);
  source.refreshPublicSource.mockResolvedValue({ root, tag: "0.3.0", commit: "abc", release });
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("skill").mockResolvedValueOnce("exit");
  if (action === "throw") prompts.checkbox.mockRejectedValueOnce(new Error("selection failed"));
  await runInteractive();
  expect(release).toHaveBeenCalledExactlyOnceWith();
});
it("uses the validated local snapshot when startup tags match", async () => {
  const cached = { root, tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  inventory.collectInstalled.mockReturnValue({ rows: [], source: { tag: "0.1.0", commit: "abcdef1234" } });
  source.acquireCachedSource.mockResolvedValue(cached);
  plugins.listAllManagedPlugins.mockReturnValue([{ name: "workflow", hosts: ["codex"] }]);
  plugins.installPlugin.mockResolvedValue({ pluginId: "workflow@luminae-helper", version: "1.2.3" });
  prompts.checkbox.mockResolvedValueOnce(["workflow"]).mockResolvedValueOnce(["codex"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(source.refreshPublicSource).not.toHaveBeenCalled();
  expect(source.acquireCachedSource).toHaveBeenCalledTimes(1);
  expect(plugins.installPlugin).toHaveBeenCalledExactlyOnceWith("workflow", undefined, "codex", root);
  expect(cached.release).toHaveBeenCalled();
});

it("pulls at most once per session across install panels", async () => {
  const snapshot = { root: "/fixture/snapshot", tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  plugins.listAllManagedPlugins.mockReturnValue([{ name: "workflow", hosts: ["codex"] }]);
  plugins.installPlugin.mockResolvedValue({ pluginId: "workflow@luminae-helper", version: "1.2.3" });
  prompts.checkbox.mockResolvedValueOnce(["workflow"]).mockResolvedValueOnce(["codex"])
    .mockResolvedValueOnce(["workflow"]).mockResolvedValueOnce(["codex"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm")
    .mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(source.refreshPublicSource).toHaveBeenCalledTimes(1);
  expect(plugins.installPlugin).toHaveBeenCalledTimes(2);
});

it("releases a cache lease when the user declines it", async () => {
  const release = vi.fn().mockResolvedValue(undefined);
  source.refreshPublicSource.mockRejectedValue(new Error("offline"));
  source.acquireCachedSource.mockResolvedValue({ root, tag: "0.2.0", commit: "old", release });
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("skill").mockResolvedValueOnce("back").mockResolvedValueOnce("exit");
  await runInteractive(); expect(release).toHaveBeenCalledExactlyOnceWith();
});

it("steps back through plugin selection, tools and confirmation", async () => {
  source.refreshPublicSource.mockResolvedValue({ root, tag: "0.1.0", commit: "abcdef1234", release: vi.fn() });
  plugins.listAllManagedPlugins.mockReturnValue([{ name: "workflow", hosts: ["codex"] }]);
  plugins.installPlugin.mockResolvedValue({ pluginId: "workflow@luminae-helper", version: "1.2.3" });
  prompts.checkbox.mockResolvedValueOnce(["workflow"])
    .mockResolvedValueOnce(["__back__"])
    .mockResolvedValueOnce(["workflow"])
    .mockResolvedValueOnce(["codex"])
    .mockResolvedValueOnce(["codex"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin")
    .mockResolvedValueOnce("back").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  const pluginStep = prompts.checkbox.mock.calls[0][0];
  const toolStep = prompts.checkbox.mock.calls[1][0];
  const confirmStep = prompts.select.mock.calls[2][0];
  expect(pluginStep.choices.find(choice => choice.value === "workflow").checked).toBe(true);
  expect(pluginStep.choices.find(choice => choice.value === "__back__").name).toBe("↩ 返回主菜单");
  expect(toolStep.choices.find(choice => choice.value === "__back__").name).toBe("↩ 上一步");
  expect(confirmStep.choices.find(choice => choice.value === "back").name).toBe("↩ 上一步");
  expect(plugins.installPlugin).toHaveBeenCalledTimes(1);
});

it("uninstalls a managed plugin after confirming the host", async () => {
  plugins.listInstalledPlugins.mockImplementation(host => host === "codex" ? [{ name: "workflow" }] : []);
  plugins.uninstallPlugin.mockResolvedValue({ pluginId: "workflow" });
  prompts.checkbox.mockResolvedValueOnce(["codex"]).mockResolvedValueOnce(["workflow"]);
  prompts.select.mockResolvedValueOnce("uninstall").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm");
  await runInteractive();
  expect(plugins.uninstallPlugin).toHaveBeenCalledExactlyOnceWith("workflow", "codex");
});

it("uninstalls several plugins across hosts in one pass", async () => {
  plugins.listInstalledPlugins.mockImplementation(host => (
    host === "codex" ? [{ name: "a" }, { name: "b" }] : [{ name: "c" }]
  ));
  plugins.uninstallPlugin.mockImplementation(name => name === "b" ? Promise.reject(new Error("boom")) : Promise.resolve({ pluginId: name }));
  prompts.checkbox.mockResolvedValueOnce(["codex", "claude-code"])
    .mockResolvedValueOnce(["a", "b"]).mockResolvedValueOnce(["c"]);
  prompts.select.mockResolvedValueOnce("uninstall").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm");
  await runInteractive();
  expect(plugins.uninstallPlugin.mock.calls).toEqual([["a", "codex"], ["b", "codex"], ["c", "claude-code"]]);
  const output = console.log.mock.calls.flat().join("\n");
  expect(output).toContain("待卸载内容");
  expect(output).not.toContain("正在卸载");
  expect(output).toContain("boom");
});

it("installs plugins immediately after choosing plugins and hosts", async () => {
  const snapshot = { root: "/fixture/snapshot", tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  plugins.listAllManagedPlugins.mockReturnValue([{ name: "workflow", hosts: ["codex"] }]);
  plugins.installPlugin.mockResolvedValue({ pluginId: "workflow@luminae-helper", version: "1.2.3" });
  prompts.checkbox.mockResolvedValueOnce(["workflow"]).mockResolvedValueOnce(["codex"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(source.refreshPublicSource).toHaveBeenCalledTimes(1);
  expect(plugins.installPlugin).toHaveBeenCalledExactlyOnceWith("workflow", undefined, "codex", snapshot.root);
});

it("offers the aggregated plugin catalog before host selection", async () => {
  const snapshot = { root: "/fixture/snapshot", tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  plugins.listAllManagedPlugins.mockReturnValue([{ name: "ai-development-workflow", hosts: ["codex", "claude-code"] }]);
  prompts.checkbox.mockResolvedValueOnce(["ai-development-workflow"]).mockResolvedValueOnce(["codex"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  const selection = prompts.checkbox.mock.calls.find(([config]) => config.message === "选择插件:")[0];
  expect(selection.choices.filter(choice => choice.value && !choice.value.startsWith("__"))
    .map(choice => choice.value)).toEqual(["ai-development-workflow"]);
  expect(selection.choices.some(choice => choice.value === "__next__")).toBe(true);
  expect(prompts.checkbox.mock.calls[1][0].message).toBe("选择工具:");
  expect(prompts.checkbox.mock.calls[1][0].choices.some(choice => choice.value === "__next__")).toBe(true);
  expect(plugins.installPlugin).toHaveBeenCalledExactlyOnceWith("ai-development-workflow", undefined, "codex", snapshot.root);
  expect(snapshot.release).toHaveBeenCalled();
});

it("installs a plugin in the selected compatible host", async () => {
  const snapshot = { root: "/fixture/snapshot", tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  plugins.listAllManagedPlugins.mockReturnValue([{ name: "ai-development-workflow", hosts: ["codex", "claude-code"] }]);
  prompts.checkbox.mockResolvedValueOnce(["ai-development-workflow"]).mockResolvedValueOnce(["claude-code"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(plugins.installPlugin).toHaveBeenCalledExactlyOnceWith("ai-development-workflow", undefined, "claude-code", snapshot.root);
});

it("installs every selected plugin into every selected host", async () => {
  const snapshot = { root: "/fixture/snapshot", tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  plugins.listAllManagedPlugins.mockReturnValue([
    { name: "a", version: "1.0.0", hosts: ["codex", "claude-code"] },
    { name: "b", version: "2.0.0", hosts: ["codex", "claude-code"] },
  ]);
  plugins.installPlugin.mockImplementation((name, _source, host) => Promise.resolve({ pluginId: `${name}@luminae-helper`, version: `${host}-${name}` }));
  prompts.checkbox.mockResolvedValueOnce(["a", "b"]).mockResolvedValueOnce(["codex", "claude-code"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(plugins.installPlugin.mock.calls).toEqual([
    ["a", undefined, "codex", snapshot.root], ["b", undefined, "codex", snapshot.root],
    ["a", undefined, "claude-code", snapshot.root], ["b", undefined, "claude-code", snapshot.root],
  ]);
  const resultTable = console.log.mock.calls.map(([line]) => String(line)).join("\n");
  expect(resultTable).toContain("待安装内容");
  expect(resultTable).toContain("安装结果");
});

it("installs only supported combinations and reports skipped ones with reasons", async () => {
  const snapshot = { root: "/fixture/snapshot", tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  plugins.listAllManagedPlugins.mockReturnValue([
    { name: "a", version: "1.0.0", hosts: ["codex"] },
    { name: "b", version: "2.0.0", hosts: ["claude-code"] },
  ]);
  plugins.installPlugin.mockResolvedValue({ pluginId: "x", version: "1.0.0" });
  prompts.checkbox.mockResolvedValueOnce(["a", "b"]).mockResolvedValueOnce(["codex", "claude-code"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(plugins.installPlugin.mock.calls).toEqual([
    ["a", undefined, "codex", snapshot.root],
    ["b", undefined, "claude-code", snapshot.root],
  ]);
  const output = console.log.mock.calls.map(([line]) => String(line)).join("\n");
  expect(output).toContain("不支持");
  expect(output).toContain("该工具清单中没有此插件");
  expect(output).toContain("2 项不支持已跳过");
});

it("stops when the selection has no supported combination", async () => {
  const snapshot = { root: "/fixture/snapshot", tag: "0.1.0", commit: "abcdef1234", release: vi.fn() };
  source.refreshPublicSource.mockResolvedValue(snapshot);
  plugins.listAllManagedPlugins.mockReturnValue([{ name: "a", version: "1.0.0", hosts: ["codex"] }]);
  prompts.checkbox.mockResolvedValueOnce(["a"]).mockResolvedValueOnce(["claude-code"]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(plugins.installPlugin).not.toHaveBeenCalled();
  const output = console.log.mock.calls.map(([line]) => String(line)).join("\n");
  expect(output).toContain("没有可安装的组合");
});
