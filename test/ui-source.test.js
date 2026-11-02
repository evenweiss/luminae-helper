import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const prompts = vi.hoisted(() => ({ select: vi.fn(), input: vi.fn(), checkbox: vi.fn() }));
const source = vi.hoisted(() => ({ refreshPublicSource: vi.fn(), readCachedSource: vi.fn(), publicSourceOptions: () => ({}) }));
vi.mock("@inquirer/prompts", () => ({ select: prompts.select, input: prompts.input, Separator: class {} }));
vi.mock("../src/lib/checkbox-with-action-rows.js", () => ({ default: prompts.checkbox }));
vi.mock("../src/lib/public-source.js", () => source);
vi.mock("../src/utils/platform.js", () => ({ commandExists: () => true }));
const root = mkdtempSync(join(tmpdir(), "ui-source-"));
process.env.HOME = join(root, "home");
mkdirSync(join(root, "skills", "runtime"), { recursive: true });
writeFileSync(join(root, "skills/runtime/SKILL.md"), "---\nname: runtime\ndescription: test\n---\nbody");
const { runInteractive } = await import("../src/lib/ui.js");
const { SKILLS } = await import("../src/lib/constants.js");
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "clear").mockImplementation(() => {});
  prompts.input.mockResolvedValue(""); prompts.checkbox.mockResolvedValue(["__back__"]);
  SKILLS.splice(0);
});
it("loads runtime skills before offering the install list", async () => {
  source.refreshPublicSource.mockResolvedValue({ root, tag: "0.3.0", commit: "abc" });
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(SKILLS.map(s => s.id)).toEqual(["runtime"]);
});
it.each([false, true])("only loads stale cache after explicit consent=%s", async (consent) => {
  source.refreshPublicSource.mockRejectedValue(new Error("offline"));
  source.readCachedSource.mockReturnValue({ root, tag: "0.2.0", commit: "old" });
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce(consent ? "cache" : "back").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(SKILLS.map(s => s.id)).toEqual(consent ? ["runtime"] : []);
});
it("first download failure returns without an install list", async () => {
  source.refreshPublicSource.mockRejectedValue(new Error("offline")); source.readCachedSource.mockReturnValue(null);
  prompts.select.mockResolvedValueOnce("install").mockResolvedValueOnce("exit");
  await runInteractive(); expect(SKILLS).toEqual([]);
});
it("uninstall needs neither remote source nor cache", async () => {
  source.refreshPublicSource.mockRejectedValue(new Error("must not fetch"));
  prompts.select.mockResolvedValueOnce("uninstall").mockResolvedValueOnce("exit");
  await runInteractive();
  expect(source.refreshPublicSource).not.toHaveBeenCalled(); expect(source.readCachedSource).not.toHaveBeenCalled();
});
