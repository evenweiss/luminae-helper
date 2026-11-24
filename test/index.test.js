import { beforeEach, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ runInteractive: vi.fn(), printInstalledContent: vi.fn(), TERM_GUTTER: "  " }));
const plugins = vi.hoisted(() => ({ runPluginCommand: vi.fn() }));
vi.mock("../src/lib/codex-plugin.js", () => plugins);
const version = vi.hoisted(() => ({ printVersion: vi.fn(), checkOutdated: vi.fn() }));
vi.mock("../src/lib/ui.js", () => ui);
vi.mock("../src/utils/version.js", () => version);
const api = await import("../src/index.js");
beforeEach(() => { vi.resetAllMocks(); });

it("keeps standalone menu and version behavior", async () => {
  expect(await api.runCli([])).toBe(0);
  expect(ui.runInteractive).toHaveBeenCalledOnce();
  await api.runCli(["--version"]); await api.runCli(["outdated"]);
  expect(version.printVersion).toHaveBeenCalledOnce(); expect(version.checkOutdated).toHaveBeenCalledOnce();
});

it("prints help and rejects unknown commands without opening the menu", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await api.runCli(["--help"])).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain("用法");
    expect(await api.runCli(["foo"])).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("未知命令");
  } finally { log.mockRestore(); error.mockRestore(); }
  expect(ui.runInteractive).not.toHaveBeenCalled();
});

it("lists installed content without launching the interactive menu", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try { expect(await api.runCli(["list"])).toBe(0); }
  finally { log.mockRestore(); }
  expect(ui.printInstalledContent).toHaveBeenCalledOnce();
  expect(ui.runInteractive).not.toHaveBeenCalled();
});

it("installs a plugin from arguments without launching the interactive menu", async () => {
  const args = ["install", "workflow", "--source", "/fixture/local source"];
  expect(await api.runCli(["plugin", ...args])).toBe(0);
  expect(plugins.runPluginCommand).toHaveBeenCalledExactlyOnceWith(args);
  expect(ui.runInteractive).not.toHaveBeenCalled();
});

it("returns a failing CLI exit code for a native plugin failure", async () => {
  plugins.runPluginCommand.mockRejectedValue(new Error("plugin not found"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { expect(await api.runCli(["plugin", "install", "unknown"])).toBe(1); }
  finally { log.mockRestore(); }
  expect(ui.runInteractive).not.toHaveBeenCalled();
});
