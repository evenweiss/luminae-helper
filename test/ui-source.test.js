import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const prompts = vi.hoisted(() => ({ select: vi.fn(), input: vi.fn(), checkbox: vi.fn() }));
const plugins = vi.hoisted(() => ({ PLUGIN_HOSTS: ["codex", "claude-code"], listManagedPlugins: vi.fn(), readLocalPluginSource: vi.fn(), installPlugin: vi.fn(), printPluginResult: vi.fn() }));
vi.mock("../src/lib/codex-plugin.js", () => plugins);
const source = vi.hoisted(() => ({ refreshPublicSource: vi.fn(), acquireCachedSource: vi.fn(), publicSourceOptions: () => ({}) }));
vi.mock("@inquirer/prompts", () => ({ select: prompts.select, input: prompts.input, Separator: class {} }));
vi.mock("../src/lib/checkbox-with-action-rows.js", () => ({ default: prompts.checkbox }));
vi.mock("../src/lib/public-source.js", () => source);
vi.mock("../src/utils/platform.js", () => ({ commandExists: () => true }));
const root = mkdtempSync(join(tmpdir(), "ui-source-"));
process.env.HOME = join(root, "home");
mkdirSync(join(root, "skills", "runtime"), { recursive: true });
writeFileSync(join(root, "skills/runtime/SKILL.md"), "---\nname: runtime\ndescription: test\n---\nbody");
const { runInteractive, runOperation } = await import("../src/lib/ui.js");
const { SKILLS } = await import("../src/lib/constants.js");
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "clear").mockImplementation(() => {});
  prompts.input.mockResolvedValue(""); prompts.checkbox.mockResolvedValue(["__back__"]);
  SKILLS.splice(0);
});
it("loads runtime skills before offering the install list", async () => {
  source.refreshPublicSource.mockResolvedValue({ root, tag: "0.3.0", commit: "abc" });
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("skill").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(SKILLS.map(s => s.id)).toEqual(["runtime"]);
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
  prompts.select.mockResolvedValueOnce("uninstall").mockResolvedValueOnce("exit");
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
it("releases a cache lease when the user declines it", async () => {
  const release = vi.fn().mockResolvedValue(undefined);
  source.refreshPublicSource.mockRejectedValue(new Error("offline"));
  source.acquireCachedSource.mockResolvedValue({ root, tag: "0.2.0", commit: "old", release });
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("skill").mockResolvedValueOnce("back").mockResolvedValueOnce("exit");
  await runInteractive(); expect(release).toHaveBeenCalledExactlyOnceWith();
});

it("single operation goes directly to skill selection, cancels back and releases the lease", async () => {
  const release = vi.fn().mockResolvedValue(undefined);
  source.refreshPublicSource.mockResolvedValue({ root, tag: "0.3.0", commit: "abc", release });
  await runOperation("install");
  expect(SKILLS.map(s => s.id)).toEqual(["runtime"]);
  expect(prompts.select).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
it("single uninstall remains offline", async () => {
  await runOperation("uninstall");
  expect(source.refreshPublicSource).not.toHaveBeenCalled();
  expect(source.acquireCachedSource).not.toHaveBeenCalled();
});
it("single install completion releases its lease and labels the return to the wrapper menu", async () => {
  const release = vi.fn().mockResolvedValue(undefined);
  source.refreshPublicSource.mockResolvedValue({ root, tag: "0.3.0", commit: "abc", release });
  prompts.checkbox.mockResolvedValueOnce(["runtime"]).mockResolvedValueOnce(["codex"]);
  prompts.select.mockResolvedValueOnce("confirm");
  await runOperation("install");
  expect(release).toHaveBeenCalledOnce();
  expect(prompts.input.mock.calls.some(([config]) => config.message.includes("返回主菜单"))).toBe(true);
  expect(prompts.select.mock.calls.some(([config]) => config.message === "选择操作:")).toBe(false);
});
it("single operation reports an explicit exit from the skill list", async () => {
  const release = vi.fn().mockResolvedValue(undefined);
  source.refreshPublicSource.mockResolvedValue({ root, tag: "0.3.0", commit: "abc", release });
  prompts.checkbox.mockResolvedValueOnce(["__exit__"]);
  await expect(runOperation("install")).resolves.toBe("abort");
  expect(release).toHaveBeenCalledOnce();
});


it.each([true, false])("uses the shared plugin installer only after interactive confirmation=%s", async (confirm) => {
  const selected = { name: "workflow" };
  plugins.readLocalPluginSource.mockReturnValue({ directory: "/fixture/local source", plugins: [selected] });
  plugins.installPlugin.mockResolvedValue({ pluginId: `${selected.name}@local`, version: "1.2.3" });
  prompts.input.mockResolvedValueOnce("/fixture/local source");
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("codex")
    .mockResolvedValueOnce(selected.name).mockResolvedValueOnce(confirm ? "confirm" : "back")
    .mockResolvedValueOnce(confirm ? "exit" : "__back__").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(source.refreshPublicSource).not.toHaveBeenCalled();
  if (confirm) expect(plugins.installPlugin).toHaveBeenCalledExactlyOnceWith(selected.name, "/fixture/local source", "codex");
  else expect(plugins.installPlugin).not.toHaveBeenCalled();
});


it("offers only the Helper catalog when no local source is supplied", async () => {
  plugins.listManagedPlugins.mockReturnValue([{ name: "ai-development-workflow" }]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("codex")
    .mockResolvedValueOnce("ai-development-workflow").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  const selection = prompts.select.mock.calls.find(([config]) => config.message === "选择 Codex 插件:")[0];
  expect(selection.choices.filter(choice => choice.value && !choice.value.startsWith("__"))
    .map(choice => choice.value)).toEqual(["ai-development-workflow"]);
  expect(plugins.installPlugin).toHaveBeenCalledExactlyOnceWith("ai-development-workflow", undefined, "codex");
  expect(plugins.readLocalPluginSource).not.toHaveBeenCalled();
});

it("selects the Claude Code catalog and installs in the selected host", async () => {
  plugins.listManagedPlugins.mockReturnValue([{ name: "ai-development-workflow" }]);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("plugin").mockResolvedValueOnce("claude-code")
    .mockResolvedValueOnce("ai-development-workflow").mockResolvedValueOnce("confirm").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(plugins.listManagedPlugins).toHaveBeenCalledExactlyOnceWith("claude-code");
  expect(plugins.installPlugin).toHaveBeenCalledExactlyOnceWith("ai-development-workflow", undefined, "claude-code");
});
