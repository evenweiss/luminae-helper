import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const fixture = vi.hoisted(() => ({ home: "", refresh: vi.fn(), release: vi.fn(), commandExists: vi.fn() }));
vi.mock("os", async original => ({ ...await original(), homedir: () => fixture.home }));
vi.mock("../src/lib/public-source.js", () => ({ refreshPublicSource: fixture.refresh }));
vi.mock("../src/utils/platform.js", () => ({ commandExists: fixture.commandExists }));
const { runCli } = await import("../src/index.js");
const { discoverInstalledSkills, TOOLS } = await import("../src/lib/constants.js");
const { uninstallSkillFromTool } = await import("../src/lib/installer.js");

let root, source, oldCommand, installed;
const managed = "---\nname: git-push\nmanaged-by: luminae-helper\n---\nlegacy copy\n";
function put(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function install(skillId = "git-push", tool = "claude-code") {
  return runCli({ argv: ["skill", "install", skillId, "--tool", tool] });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "luminae-skill-command-"));
  source = join(root, "source");
  fixture.home = join(root, "home");
  oldCommand = join(fixture.home, ".claude", "commands", "git-push.md");
  installed = join(fixture.home, ".claude", "skills", "git-push", "SKILL.md");
  vi.resetAllMocks();
  fixture.refresh.mockResolvedValue({ root: source, tag: "0.8.0", commit: "abc", release: fixture.release });
  fixture.commandExists.mockReturnValue(true);
  put(join(source, "commands/git-push/SKILL.md"), "---\nname: git-push\n---\nfrom legacy source\n");
  put(join(source, "commands/git-push/references/guide.md"), "include this reference\n");
  put(join(source, "skills/identity/SKILL.md"), "---\nname: identity\n---\nsource\n");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

it("installs only the chosen current skill and migrates its owned legacy command after success", async () => {
  put(oldCommand, managed);
  expect(await install()).toBe(0);
  expect(readFileSync(installed, "utf8")).toContain("from legacy source");
  expect(readFileSync(join(dirname(installed), "references/guide.md"), "utf8")).toBe("include this reference\n");
  expect(readdirSync(dirname(dirname(installed)))).toEqual(["git-push"]);
  expect(existsSync(oldCommand)).toBe(false);
  expect(existsSync(join(fixture.home, ".codex"))).toBe(false);
  expect(fixture.release).toHaveBeenCalledOnce();
});

it("prefers the canonical skill if both source layouts contain the same ID", async () => {
  put(join(source, "skills/git-push/SKILL.md"), "---\nname: git-push\n---\ncanonical skill\n");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await install()).toBe(0);
  expect(readFileSync(installed, "utf8")).toContain("canonical skill");
  expect(warn).toHaveBeenCalledOnce();
});

it("protects an unmanaged same-name command and leaves it out of uninstall", async () => {
  put(oldCommand, "user content\n");
  expect(await install()).toBe(1);
  expect(readFileSync(oldCommand, "utf8")).toBe("user content\n");
  expect(existsSync(installed)).toBe(false);
  expect(discoverInstalledSkills()).toEqual([]);
});

it("keeps an owned legacy command if the Skill install fails and can uninstall it offline", async () => {
  put(oldCommand, managed);
  put(installed, "another user's skill\n");
  expect(await install()).toBe(1);
  expect(readFileSync(oldCommand, "utf8")).toBe(managed);
  const [legacy] = discoverInstalledSkills();
  expect(uninstallSkillFromTool(legacy, TOOLS.find(t => t.id === "claude-code")).success).toBe(true);
  expect(existsSync(oldCommand)).toBe(false);
  expect(readFileSync(installed, "utf8")).toBe("another user's skill\n");
});

it("rejects an unknown ID from the actual catalog and releases its snapshot", async () => {
  expect(await install("missing")).toBe(1);
  expect(console.error.mock.calls.flat().join(" ")).toMatch(/git-push.*identity|identity.*git-push/);
  expect(existsSync(fixture.home)).toBe(false);
  expect(fixture.release).toHaveBeenCalledOnce();
});

it("rejects an unsupported or unavailable host before fetching the source", async () => {
  expect(await install("identity", "unknown-tool")).toBe(1);
  fixture.commandExists.mockReturnValue(false);
  expect(await install("identity", "codex")).toBe(1);
  expect(fixture.refresh).not.toHaveBeenCalled();
});

it("reports a failed refresh without installing from an older catalog", async () => {
  fixture.refresh.mockRejectedValueOnce(new Error("offline"));
  expect(await install()).toBe(1);
  expect(console.error.mock.calls.flat().join(" ")).toContain("offline");
  expect(existsSync(installed)).toBe(false);
});
