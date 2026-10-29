import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 必须在 import 之前重定向 HOME 与 package root：
// constants.js 在模块加载时发现技能，tool 目标路径用 homedir() 现算。
const root = mkdtempSync(join(tmpdir(), "luminae-installer-"));
const home = join(root, "home");
const pkg = join(root, "pkg");
mkdirSync(home, { recursive: true });
mkdirSync(join(pkg, "skills", "demo-skill"), { recursive: true });
writeFileSync(join(pkg, "skills", "demo-skill", "SKILL.md"), "---\nname: demo-skill\ndescription: 测试用\n---\nbody\n");
writeFileSync(join(root, "outside.txt"), "SECRET-OUTSIDE\n");
symlinkSync(join(root, "outside.txt"), join(pkg, "skills", "demo-skill", "leak.md"));

process.env.HOME = home;
globalThis.__LUMINAE_PACKAGE_ROOT__ = pkg;

const { installSkillToTool, uninstallSkillFromTool } = await import("../src/lib/installer.js");
const { SKILLS, TOOLS } = await import("../src/lib/constants.js");

const skill = SKILLS.find(s => s.id === "demo-skill");
const tool = TOOLS.find(t => t.id === "claude-code");
const destDir = join(home, ".claude", "skills", "demo-skill");

describe("installer 目标目录守卫", () => {
  it("测试环境自检：目标落在临时 HOME 内", () => {
    expect(skill).toBeTruthy();
    expect(destDir.startsWith(home)).toBe(true);
  });

  it("非本工具安装的同名目录：跳过且不破坏原内容", () => {
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "SKILL.md"), "---\nname: demo-skill\n---\n用户自己写的\n");
    writeFileSync(join(destDir, "mine.txt"), "keep me\n");

    const res = installSkillToTool(skill, tool);
    expect(res.success).toBe(false);
    expect(res.skipped).toBe(true);
    expect(readFileSync(join(destDir, "SKILL.md"), "utf-8")).toContain("用户自己写的");
    expect(existsSync(join(destDir, "mine.txt"))).toBe(true);
  });

  it("干净目标：安装成功，注入 managed-by，软链不被复制", () => {
    rmSync(destDir, { recursive: true, force: true });

    const res = installSkillToTool(skill, tool);
    expect(res.success).toBe(true);
    expect(readFileSync(join(destDir, "SKILL.md"), "utf-8")).toContain("managed-by: luminae-helper");
    expect(existsSync(join(destDir, "leak.md"))).toBe(false);
  });

  it("已由本工具安装：允许覆盖升级", () => {
    const res = installSkillToTool(skill, tool);
    expect(res.success).toBe(true);
    expect(readFileSync(join(destDir, "SKILL.md"), "utf-8")).toContain("managed-by: luminae-helper");
  });

  it("卸载：删掉本工具安装的目录", () => {
    const res = uninstallSkillFromTool(skill, tool);
    expect(res.success).toBe(true);
    expect(existsSync(destDir)).toBe(false);
  });
});
