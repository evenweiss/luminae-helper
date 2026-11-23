import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "source-integration-"));
process.env.HOME = join(root, "home");
const { SKILLS, TOOLS, setSkillsSource, discoverInstalledSkills } = await import("../src/lib/constants.js");
const { installSkillToTool, uninstallSkillFromTool } = await import("../src/lib/installer.js");
afterAll(() => rmSync(root, { recursive: true, force: true }));
function source(name, text) {
  const dir = join(root, name);
  mkdirSync(join(dir, "skills", "demo"), { recursive: true });
  writeFileSync(join(dir, "skills/demo/SKILL.md"), `---\nname: demo\ndescription: test\n---\n${text}`);
  return dir;
}
describe("runtime source integration", () => {
  it("refreshes discovery and copy source together", () => {
    const first = source("first", "old");
    const second = source("second", "new");
    const tool = TOOLS.find(t => t.id === "codex");
    setSkillsSource(first);
    expect(installSkillToTool(SKILLS[0], tool).success).toBe(true);
    setSkillsSource(second);
    expect(installSkillToTool(SKILLS[0], tool).success).toBe(true);
    expect(readFileSync(join(tool.skillDir(), "demo/SKILL.md"), "utf8")).toContain("new");
  });
  it("discovers and uninstalls managed content offline after all sources disappear, preserving user files and links", () => {
    const tool = TOOLS.find(t => t.id === "codex");
    mkdirSync(join(tool.skillDir(), "user"));
    writeFileSync(join(tool.skillDir(), "user/SKILL.md"), "user content");
    symlinkSync(join(tool.skillDir(), "demo"), join(tool.skillDir(), "linked"));
    rmSync(join(root, "first"), { recursive: true }); rmSync(join(root, "second"), { recursive: true });
    const found = discoverInstalledSkills([tool]);
    expect(found.map(s => s.name)).toEqual(["demo"]);
    expect(uninstallSkillFromTool(found[0], tool).success).toBe(true);
    expect(existsSync(join(tool.skillDir(), "demo"))).toBe(false);
    expect(readFileSync(join(tool.skillDir(), "user/SKILL.md"), "utf8")).toBe("user content");
  });
});
