import "./fixture.js";
import { describe, it, expect } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync, readFileSync, rmSync } from "fs";
import { TOOLS, SKILLS, detectInstalledTools } from "../src/lib/constants.js";
import { installSkillToTool, uninstallSkillFromTool } from "../src/lib/installer.js";
import { commandExists } from "../src/utils/platform.js";

function withTempTarget(skill) {
  const tmpDir = join(tmpdir(), "luminae-helper-test-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  return {
    skill: {
      ...skill,
      installTargets: [
        {
          toolId: "test-tool",
          installMode: "dir",
          destPath: () => join(tmpDir, skill.id),
        },
      ],
    },
    tool: {
      id: "test-tool",
      name: "Test Tool",
    },
    destPath: join(tmpDir, skill.id),
    tmpDir,
  };
}

describe("constants.js", () => {
  describe("TOOLS", () => {
    it("should have at least 1 tool", () => {
      expect(TOOLS.length).toBeGreaterThan(0);
    });

    it("each tool has required fields", () => {
      for (const tool of TOOLS) {
        expect(tool).toHaveProperty("id");
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("command");
        expect(tool).toHaveProperty("commandDir");
        expect(tool).toHaveProperty("skillDir");
        expect(tool).toHaveProperty("installHint");
        expect(tool.commandDir || tool.skillDir).toBeTruthy();
      }
    });
  });

  describe("discoverSkills", () => {
    it("should find entries from bundled commands/ or skills/ directories", () => {
      expect(SKILLS.length).toBeGreaterThan(0);
      expect(SKILLS.map(s => s.id)).toEqual(expect.arrayContaining(["git-push", "identity"]));
    });

    it("each skill has id, name, description, installTargets", () => {
      for (const skill of SKILLS) {
        expect(skill).toHaveProperty("id");
        expect(skill).toHaveProperty("name");
        expect(skill).toHaveProperty("description");
        expect(skill).toHaveProperty("installTargets");
        expect(skill.installTargets.length).toBe(TOOLS.length);
      }
    });

    it("skill with YAML frontmatter should parse name and description", () => {
      const identity = SKILLS.find(s => s.id === "identity");
      expect(identity).toBeDefined();
      // frontmatter 中的 name 优先于 skillId 推导
      expect(identity.name).toBe("identity");
    });

    it("installTargets destPath should be a function returning a string", () => {
      for (const skill of SKILLS) {
        for (const target of skill.installTargets) {
          expect(typeof target.destPath).toBe("function");
          expect(typeof target.destPath()).toBe("string");
        }
      }
    });

    it("routes every source entry to Skill directories for all supported tools", () => {
      for (const skill of SKILLS) {
        for (const target of skill.installTargets) {
          const tool = TOOLS.find(t => t.id === target.toolId);
          expect(target.installMode).toBe("dir");
          expect(target.destPath()).toBe(join(tool.skillDir(), skill.id));
        }
      }
    });
  });

  describe("detectInstalledTools", () => {
    it("returns all tools with installed boolean", () => {
      const result = detectInstalledTools();
      expect(result.length).toBe(TOOLS.length);
      for (const tool of result) {
        expect(typeof tool.installed).toBe("boolean");
      }
    });
  });

});

// ── installer.js ──
describe("installer.js", () => {
  describe("installSkillToTool", () => {
    it("should install a skill in dir mode", () => {
      const { skill, tool, destPath, tmpDir } = withTempTarget(SKILLS.find(s => s.id === "identity"));
      const result = installSkillToTool(skill, tool);
      expect(result.success).toBe(true);
      if (existsSync(destPath)) rmSync(destPath, { recursive: true, force: true });
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should fail if skill source not found", () => {
      const tmpDir = join(tmpdir(), "luminae-helper-test-" + Date.now());
      const fakeSkill = {
        id: "nonexistent",
        name: "Fake",
        description: "Nope",
        installTargets: TOOLS.map(t => ({
          toolId: t.id,
          installMode: "dir",
          destPath: () => join(tmpDir, "fake"),
        })),
      };
      const result = installSkillToTool(fakeSkill, { id: TOOLS[0].id, name: TOOLS[0].name });
      expect(result.success).toBe(false);
      expect(result.message).toContain("找不到 nonexistent 的技能源");
    });
  });

  describe("uninstallSkillFromTool", () => {
    it("should uninstall a dir-mode skill after installing", () => {
      const { skill, tool, tmpDir } = withTempTarget(SKILLS.find(s => s.id === "identity"));

      const installResult = installSkillToTool(skill, tool);
      expect(installResult.success).toBe(true);

      const result = uninstallSkillFromTool(skill, tool);
      expect(result.success).toBe(true);
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should return failure if not installed", () => {
      const { skill, tool, tmpDir } = withTempTarget(SKILLS.find(s => s.id === "git-push"));

      const result = uninstallSkillFromTool(skill, tool);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Not installed");
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("install then verify content", () => {
    it("installed SKILL.md content includes source plus managed-by marker", () => {
      const { skill, tool, destPath, tmpDir } = withTempTarget(SKILLS.find(s => s.id === "git-push"));

      installSkillToTool(skill, tool);
      const srcPath = join(skill.sourceDir, "SKILL.md");

      const destContent = readFileSync(join(destPath, "SKILL.md"), "utf-8");
      const srcContent = readFileSync(srcPath, "utf-8");
      // 安装后的文件包含 managed-by 标识（注入进已有 frontmatter）
      expect(destContent).toContain("managed-by: luminae-helper");
      // 移除新增 metadata 后与源一致
      expect(destContent.replace("metadata:\n  managed-by: luminae-helper\n", "")).toBe(srcContent);

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("dir mode should copy all files from skill directory", () => {
      const { skill, tool, destPath, tmpDir } = withTempTarget(SKILLS.find(s => s.id === "identity"));

      installSkillToTool(skill, tool);
      expect(existsSync(join(destPath, "SKILL.md"))).toBe(true);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});

// ── platform.js ──
describe("platform.js", () => {
  describe("commandExists", () => {
    it("returns true for existing command (node)", () => {
      expect(commandExists("node")).toBe(true);
    });

    it("returns false for non-existent command", () => {
      expect(commandExists("definitely-not-a-real-command-xyz123")).toBe(false);
    });
  });
});
