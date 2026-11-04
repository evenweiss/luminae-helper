import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { SKILLS, discoverInstalledSkills, setSkillsSource } from "../src/lib/constants.js";
import { installSkillToTool, uninstallSkillFromTool } from "../src/lib/installer.js";

const fm = header => `---\nname: demo\n${header}\n---\nbody\n`;
const unmanaged = [
  ["same name without marker", fm("description: user")],
  ["body example", fm("description: user") + "managed-by: luminae-helper\n"],
  ["comment", fm("# managed-by: luminae-helper")],
  ["description example", fm("description: |\n  managed-by: luminae-helper")],
  ["different owner", fm("managed-by: other-tool")],
  ["owner prefix", fm("managed-by: luminae-helper-foreign")],
  ["nested different owner", fm("metadata:\n  managed-by: other-tool")],
  ["conflicting owners", fm("managed-by: luminae-helper\nmetadata:\n  managed-by: other-tool")],
  ["reverse conflicting owners", fm("managed-by: other-tool\nmetadata:\n  managed-by: luminae-helper")],
  ["duplicate legacy key", fm("managed-by: luminae-helper\nmanaged-by: luminae-helper")],
  ["duplicate nested key", fm("metadata:\n  managed-by: luminae-helper\n  managed-by: other-tool")],
  ["invalid yaml", fm("managed-by: luminae-helper\nmetadata: [")],
  ["undefined alias", fm("managed-by: luminae-helper\nother: *missing")],
  ["forward alias", fm("managed-by: luminae-helper\nother: *later\nlater: &later value")],
  ["non-map metadata", fm("managed-by: luminae-helper\nmetadata: []")],
  ["nested example", fm('metadata:\n  note: "managed-by: luminae-helper"')],
];
const managed = [
  ["legacy", fm("managed-by: luminae-helper")],
  ["quoted legacy", fm('managed-by: "luminae-helper" # owner')],
  ["metadata", fm("metadata:\n  managed-by: luminae-helper")],
  ["flow metadata", fm('metadata: { managed-by: "luminae-helper", note: keep }')],
  ["matching old and new", fm("managed-by: luminae-helper\nmetadata:\n  managed-by: luminae-helper")],
  ["BOM and CRLF", "\uFEFF" + fm("managed-by: luminae-helper").replaceAll("\n", "\r\n")],
];

describe.each(["dir", "file"])("managed migration (%s)", mode => {
  let root, dest, source, skill, tool;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "managed-migration-"));
    source = join(root, "source/skills/demo/SKILL.md");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, fm("description: source\nmetadata:\n  note: keep"));
    setSkillsSource(join(root, "source"));
    tool = { id: "fixture", skillDir: () => join(root, "skills"), commandDir: () => join(root, "commands") };
    dest = mode === "dir" ? join(tool.skillDir(), "demo") : join(tool.commandDir(), "demo.md");
    skill = { ...SKILLS[0], installTargets: [{ toolId: tool.id, installMode: mode, destPath: () => dest }] };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const contentFile = dest => mode === "dir" ? join(dest, "SKILL.md") : dest;
  function put(text) {
    const file = contentFile(dest);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    if (mode === "dir") writeFileSync(join(dest, "user.txt"), "user sentinel");
  }

  it.each(unmanaged)("preserves %s during discovery/install/uninstall", (_, text) => {
    put(text);
    expect(discoverInstalledSkills([tool])).toEqual([]);
    expect(readFileSync(contentFile(dest), "utf8")).toBe(text);
    expect(installSkillToTool(skill, tool).success).toBe(false);
    expect(uninstallSkillFromTool(skill, tool).success).toBe(false);
    expect(readFileSync(contentFile(dest), "utf8")).toBe(text);
    if (mode === "dir") expect(readFileSync(join(dest, "user.txt"), "utf8")).toBe("user sentinel");
  });

  it.each(managed)("updates and removes %s without changing source", (_, text) => {
    put(text);
    expect(discoverInstalledSkills([tool])).toHaveLength(1);
    expect(readFileSync(contentFile(dest), "utf8")).toBe(text);
    const sourceText = readFileSync(source, "utf8");
    expect(installSkillToTool(skill, tool).success).toBe(true);
    const updated = readFileSync(contentFile(dest), "utf8");
    const header = parse(updated.split("---\n")[1]);
    expect(header["managed-by"]).toBeUndefined();
    expect(header.metadata).toEqual({ note: "keep", "managed-by": "luminae-helper" });
    expect(updated.slice(updated.indexOf("\n---\n") + 5)).toBe("body\n");
    expect(readFileSync(source, "utf8")).toBe(sourceText);
    expect(installSkillToTool(skill, tool).success).toBe(true);
    expect(readFileSync(contentFile(dest), "utf8")).toBe(updated);
    expect(uninstallSkillFromTool(discoverInstalledSkills([tool])[0], tool).success).toBe(true);
    expect(existsSync(dest)).toBe(false);
  });

  it("normalizes legacy source on new install, preserving metadata/comments/body", () => {
    const text = fm("# retained comment\nmanaged-by: luminae-helper\nmetadata: { note: keep }");
    writeFileSync(source, text);
    expect(installSkillToTool(skill, tool).success).toBe(true);
    const installed = readFileSync(contentFile(dest), "utf8");
    const header = parse(installed.split("---\n")[1]);
    expect(header["managed-by"]).toBeUndefined();
    expect(header.metadata).toEqual({ note: "keep", "managed-by": "luminae-helper" });
    expect(installed).toContain("# retained comment");
    expect(installed.slice(installed.indexOf("\n---\n") + 5)).toBe("body\n");
    expect(readFileSync(source, "utf8")).toBe(text);
  });

  it.each([false, true])("migrates anchored legacy source without breaking aliases (update=%s)", update => {
    const text = fm("managed-by: &owner luminae-helper\nother: *owner\nmetadata: { note: keep }");
    writeFileSync(source, text);
    if (update) put(fm("managed-by: luminae-helper"));
    expect(installSkillToTool(skill, tool).success).toBe(true);
    const installed = readFileSync(contentFile(dest), "utf8");
    const header = parse(installed.split("---\n")[1]);
    expect(header.other).toBe("luminae-helper");
    expect(header["managed-by"]).toBeUndefined();
    expect(header.metadata).toEqual({ note: "keep", "managed-by": "luminae-helper" });
    expect(readFileSync(source, "utf8")).toBe(text);
  });

  it("preserves references to an anchored legacy key during migration", () => {
    writeFileSync(source, fm("&owner managed-by: luminae-helper\nother: *owner"));
    expect(installSkillToTool(skill, tool).success).toBe(true);
    const header = parse(readFileSync(contentFile(dest), "utf8").split("---\n")[1]);
    expect(header.other).toBe("managed-by");
    expect(header.metadata["managed-by"]).toBe("luminae-helper");
  });

  it.each([fm("metadata: ["), fm("managed-by: other-tool"), fm("managed-by: luminae-helper\nmetadata: { managed-by: other-tool }")])("invalid/conflicting source preserves existing managed target", text => {
    const original = fm("managed-by: luminae-helper");
    put(original);
    writeFileSync(source, text);
    expect(installSkillToTool(skill, tool).success).toBe(false);
    expect(readFileSync(contentFile(dest), "utf8")).toBe(original);
    if (mode === "dir") expect(readFileSync(join(dest, "user.txt"), "utf8")).toBe("user sentinel");
  });

  it.each([false, true])("preserves foreign symbolic links (dangling=%s)", dangling => {
    const outside = join(root, "outside");
    const outsideFile = mode === "dir" ? join(outside, "SKILL.md") : outside;
    if (!dangling) {
      mkdirSync(dirname(outsideFile), { recursive: true });
      writeFileSync(outsideFile, fm("managed-by: luminae-helper"));
    }
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(outside, dest);
    expect(discoverInstalledSkills([tool])).toEqual([]);
    expect(installSkillToTool(skill, tool).success).toBe(false);
    expect(uninstallSkillFromTool(skill, tool).success).toBe(false);
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);
    if (!dangling) expect(readFileSync(outsideFile, "utf8")).toBe(fm("managed-by: luminae-helper"));
  });

  if (mode === "dir") {
    it("preserves directory with a linked SKILL.md", () => {
      const outside = join(root, "outside.md");
      writeFileSync(outside, fm("managed-by: luminae-helper"));
      mkdirSync(dest, { recursive: true });
      symlinkSync(outside, join(dest, "SKILL.md"));
      expect(discoverInstalledSkills([tool])).toEqual([]);
      expect(installSkillToTool(skill, tool).success).toBe(false);
      expect(uninstallSkillFromTool(skill, tool).success).toBe(false);
      expect(lstatSync(join(dest, "SKILL.md")).isSymbolicLink()).toBe(true);
    });
  }

  it("does not delete pre-existing adjacent staging or backup content", () => {
    for (const suffix of [".__tmp__", ".__bak__"]) {
      mkdirSync(dest + suffix, { recursive: true });
      writeFileSync(join(dest + suffix, "mine.txt"), "keep adjacent");
    }
    expect(installSkillToTool(skill, tool).success).toBe(true);
    expect(installSkillToTool(skill, tool).success).toBe(true);
    for (const suffix of [".__tmp__", ".__bak__"]) expect(readFileSync(join(dest + suffix, "mine.txt"), "utf8")).toBe("keep adjacent");
  });
});
