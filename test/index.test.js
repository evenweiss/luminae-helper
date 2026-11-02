import { beforeEach, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ runInteractive: vi.fn(), runOperation: vi.fn(), TERM_GUTTER: "  " }));
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
