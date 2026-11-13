import "./fixture.js";
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SKILLS, discoverSkills } from "../src/lib/constants.js";

describe("parseSkillMeta (via discoverSkills)", () => {
  it("parses YAML frontmatter name field", () => {
    const identity = SKILLS.find(s => s.id === "identity");
    expect(identity.name).toBe("identity");
  });

  it("each skill has a name (from frontmatter or derived)", () => {
    for (const skill of SKILLS) {
      expect(skill.name).toBeTruthy();
      expect(skill.name.length).toBeGreaterThan(0);
    }
  });

  it("derives name from skillId when frontmatter has no name", () => {
    const root = mkdtempSync(join(tmpdir(), "luminae-test-skills-"));
    mkdirSync(join(root, "commands", "git-commit"), { recursive: true });
    writeFileSync(join(root, "commands", "git-commit", "SKILL.md"), "# git-commit\n\n> No frontmatter here\n");
    globalThis.__LUMINAE_PACKAGE_ROOT__ = root;
    try {
      const found = discoverSkills().find(s => s.id === "git-commit");
      expect(found.name).toBe("Git Commit");
    } finally {
      delete globalThis.__LUMINAE_PACKAGE_ROOT__;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("frontmatter name wins over skillId derivation: git-push → git-push", () => {
    const gp = SKILLS.find(s => s.id === "git-push");
    expect(gp.name).toBe("git-push");
  });

  it("each skill has a description (from frontmatter or blockquote)", () => {
    for (const skill of SKILLS) {
      expect(skill.description).toBeTruthy();
    }
  });
});
