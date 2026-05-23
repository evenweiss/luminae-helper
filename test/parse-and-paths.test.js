import { describe, it, expect } from "vitest";
import { SKILLS } from "../src/lib/constants.js";

describe("parseSkillMeta (via discoverSkills)", () => {
  it("parses YAML frontmatter name field", () => {
    const identity = SKILLS.find(s => s.id === "identity");
    expect(identity.name).toBe("Identity");
  });

  it("each skill has a name (from frontmatter or derived)", () => {
    for (const skill of SKILLS) {
      expect(skill.name).toBeTruthy();
      expect(skill.name.length).toBeGreaterThan(0);
    }
  });

  it("derives name from skillId: git-commit → Git Commit", () => {
    const gc = SKILLS.find(s => s.id === "git-commit");
    expect(gc.name).toBe("Git Commit");
  });

  it("derives name from skillId: git-push → Git Push", () => {
    const gp = SKILLS.find(s => s.id === "git-push");
    expect(gp.name).toBe("Git Push");
  });

  it("each skill has a description (from frontmatter or blockquote)", () => {
    for (const skill of SKILLS) {
      expect(skill.description).toBeTruthy();
    }
  });
});

describe("generateDestPath (via installTargets)", () => {
  it("file mode: trae destPath ends with <shortName>.md", () => {
    const skill = SKILLS.find(s => s.id === "identity");
    const target = skill.installTargets.find(t => t.toolId === "trae");
    const path = target.destPath();
    expect(path.endsWith("/identity.md") || path.endsWith("\\identity.md")).toBe(true);
  });

  it("dir mode: hermes-agent destPath ends with <skillId>", () => {
    const skill = SKILLS.find(s => s.id === "identity");
    const target = skill.installTargets.find(t => t.toolId === "hermes-agent");
    const path = target.destPath();
    expect(path.endsWith("/identity") || path.endsWith("\\identity")).toBe(true);
  });

  it("destPath for each target is consistent with target.installMode", () => {
    const entry = SKILLS.find(s => s.id === "identity");
    for (const target of entry.installTargets) {
      const path = target.destPath();
      if (target.installMode === "file") {
        expect(path.endsWith(".md")).toBe(true);
      } else {
        expect(path.endsWith(entry.id)).toBe(true);
      }
    }
  });
});
