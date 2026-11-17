import { beforeEach, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ runInteractive: vi.fn(), runOperation: vi.fn(), TERM_GUTTER: "  " }));
const plugins = vi.hoisted(() => ({ runPluginCommand: vi.fn() }));
vi.mock("../src/lib/codex-plugin.js", () => plugins);
const version = vi.hoisted(() => ({ printVersion: vi.fn(), checkOutdated: vi.fn() }));
vi.mock("../src/lib/ui.js", () => ui);
vi.mock("../src/utils/version.js", () => version);
const api = await import("../src/index.js");
beforeEach(() => { vi.resetAllMocks(); delete globalThis.__LUMINAE_PACKAGE_ROOT__; });
it("runs exactly one operation instead of the engine main menu", async () => {
  expect(typeof api.runSkillOperation).toBe("function");
  expect(await api.runSkillOperation("install", { packageRoot: "/tmp/wrapper" })).toBe(0);
  expect(ui.runOperation).toHaveBeenCalledExactlyOnceWith("install");
  expect(ui.runInteractive).not.toHaveBeenCalled();
  expect(globalThis.__LUMINAE_PACKAGE_ROOT__).toBe("/tmp/wrapper");
});
it("rejects invalid actions before an operation can touch files", async () => {
  await expect(api.runSkillOperation("delete-all")).rejects.toThrow();
  expect(ui.runOperation).not.toHaveBeenCalled();
});
it("reports an operation error to the caller without starting another menu", async () => {
  ui.runOperation.mockRejectedValue(new Error("offline"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { expect(await api.runSkillOperation("install")).toBe(1); expect(ui.runInteractive).not.toHaveBeenCalled(); }
  finally { log.mockRestore(); }
});
it("keeps standalone menu and version behavior", async () => {
  expect(await api.runCli({ argv: [] })).toBe(0);
  expect(ui.runInteractive).toHaveBeenCalledOnce();
  await api.runCli({ argv: ["--version"] }); await api.runCli({ argv: ["outdated"] });
  expect(version.printVersion).toHaveBeenCalledOnce(); expect(version.checkOutdated).toHaveBeenCalledOnce();
  expect(ui.runOperation).not.toHaveBeenCalled();
});


it("installs a plugin from arguments without launching the interactive menu", async () => {
  const args = ["install", "workflow", "--source", "/fixture/local source"];
  expect(await api.runCli({ argv: ["plugin", ...args] })).toBe(0);
  expect(plugins.runPluginCommand).toHaveBeenCalledExactlyOnceWith(args);
  expect(ui.runInteractive).not.toHaveBeenCalled();
});

it("returns a failing CLI exit code for a native plugin failure", async () => {
  plugins.runPluginCommand.mockRejectedValue(new Error("plugin not found"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { expect(await api.runCli({ argv: ["plugin", "install", "unknown"] })).toBe(1); }
  finally { log.mockRestore(); }
  expect(ui.runInteractive).not.toHaveBeenCalled();
});
