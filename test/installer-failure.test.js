import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const fault = vi.hoisted(() => ({ action: null, dest: null }));
vi.mock("fs", async importOriginal => {
  const fs = await importOriginal();
  return {
    ...fs,
    renameSync: (src, dest) => {
      const publishing = dest === fault.dest && !src.endsWith(".__bak__");
      if ((fault.action === "publish" && publishing) || (fault.action === "backup" && src === fault.dest)) {
        throw new Error("injected rename failure");
      }
      return fs.renameSync(src, dest);
    },
    writeFileSync: (file, ...args) => {
      if (fault.action === "stamp" && file.includes(".__tmp__")) throw new Error("injected write failure");
      return fs.writeFileSync(file, ...args);
    },
  };
});
const { SKILLS, setSkillsSource } = await import("../src/lib/constants.js");
const { installSkillToTool } = await import("../src/lib/installer.js");

describe("failed update preserves owned Skill and legacy command", () => {
  let root, dest, file, legacy, skill, tool;
  const original = "---\nname: demo\nmanaged-by: luminae-helper\n---\nold body\n";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "installer-failure-"));
    const source = join(root, "source/skills/demo");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: demo\n---\nnew body\n");
    setSkillsSource(join(root, "source"));
    dest = join(root, "target/demo");
    file = join(dest, "SKILL.md");
    legacy = join(root, "commands/demo.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, original);
    writeFileSync(join(dest, "mine.txt"), "old sentinel");
    mkdirSync(dirname(legacy), { recursive: true });
    writeFileSync(legacy, original);
    tool = { id: "fault-test", commandDir: () => dirname(legacy) };
    skill = { ...SKILLS[0], installTargets: [{ toolId: tool.id, installMode: "dir", destPath: () => dest }] };
    fault.dest = dest;
  });
  afterEach(() => { fault.action = null; fault.dest = null; rmSync(root, { recursive: true, force: true }); });

  it.each(["stamp", "backup", "publish"])("preserves old bytes and files when %s fails", action => {
    fault.action = action;
    expect(installSkillToTool(skill, tool).success).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(readFileSync(join(dest, "mine.txt"), "utf8")).toBe("old sentinel");
    expect(readFileSync(legacy, "utf8")).toBe(original);
    expect(readdirSync(dirname(dest))).toEqual(["demo"]);
  });
});
