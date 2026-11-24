import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = vi.hoisted(() => ({ home: "" }));
vi.mock("os", async original => ({ ...await original(), homedir: () => fixture.home }));
const { collectInstalled } = await import("../src/lib/inventory.js");

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inventory-"));
  fixture.home = join(root, "home");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("lists managed skills and plugins without calling host CLIs", () => {
  const skill = join(fixture.home, ".codex", "skills", "git-push");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: git-push\nmanaged-by: luminae-helper\n---\nbody");
  const plugin = join(fixture.home, ".cursor", "plugins", "local", "ai-development-workflow");
  mkdirSync(join(plugin, ".cursor-plugin"), { recursive: true });
  writeFileSync(join(plugin, ".luminae-helper-plugin"), "luminae-helper\n");
  writeFileSync(join(plugin, ".cursor-plugin", "plugin.json"), JSON.stringify({ name: "ai-development-workflow", version: "0.10.2" }));

  const { rows, source } = collectInstalled();
  expect(rows).toEqual([
    { type: "技能", tool: "Codex", name: "git-push", version: "—" },
    { type: "插件", tool: "Cursor", name: "ai-development-workflow", version: "0.10.2" },
  ]);
  expect(source).toBeNull();
});
