import { homedir } from "os";
import { join } from "path";
import { existsSync, readdirSync, readFileSync, lstatSync } from "fs";
import { isManagedSkill } from "./managed-by.js";
import { commandExists } from "../utils/platform.js";

// ── Tools ──

export const TOOLS = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    commandDir: () => join(homedir(), ".claude", "commands"),
    skillDir: () => join(homedir(), ".claude", "skills"),
    installHint: "npm install -g @anthropic-ai/claude-code",
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    commandDir: null,
    skillDir: () => join(homedir(), ".codex", "skills"),
    installHint: "npm install -g @openai/codex",
  },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor",
    commandDir: null,
    skillDir: () => join(homedir(), ".cursor", "skills"),
    installHint: "Download from https://cursor.com",
  },
  {
    id: "hermes-agent",
    name: "Hermes Agent",
    command: "hermes",
    commandDir: null,
    skillDir: () => join(homedir(), ".hermes", "skills"),
    installHint: "pip install hermes-ai",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    commandDir: null,
    skillDir: () => join(homedir(), ".opencode", "skills"),
    installHint: "npm install -g opencode-ai",
  },
];

// ── Skill auto-discovery ──

/** ...same as before... */
function getPackageDir() {
  if (globalThis.__LUMINAE_PACKAGE_ROOT__) {
    return globalThis.__LUMINAE_PACKAGE_ROOT__;
  }

  const selfDir = import.meta.dirname;
  if (selfDir.endsWith("/src/lib") || selfDir.endsWith("\\src\\lib")) {
    return join(selfDir, "..", "..");
  }
  if (selfDir.endsWith("/src") || selfDir.endsWith("\\src")) {
    return join(selfDir, "..");
  }
  return selfDir;
}

function parseSkillMeta(skillId, content) {
  let name = null;
  let description = null;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)/);
      if (m) {
        let value = m[2].trim();
        if (!((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'")))) {
          const hashIdx = value.indexOf(" #");
          if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
        }
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (m[1] === "name") name = value;
        if (m[1] === "description") description = value;
      }
    }
  }

  if (!name) {
    name = skillId
      .replace(/(^|-)(\w)/g, (_, p, c) => (p === "-" ? " " : "") + c.toUpperCase());
  }

  if (!description) {
    const bq = content.match(/^>\s*(.+)/m);
    if (bq) description = bq[1].trim();
  }

  return { name, description };
}

function generateInstallTargets(skillId) {
  return TOOLS.filter(tool => tool.skillDir).map(tool => ({
    toolId: tool.id,
    installMode: "dir",
    destPath: () => join(tool.skillDir(), skillId),
  }));
}

export function discoverSkills(packageDir = getPackageDir()) {
  const skills = [];
  const seenIds = new Set();

  for (const dir of ["skills", "commands"]) {
    const typePath = join(packageDir, dir);
    if (!existsSync(typePath) || !lstatSync(typePath).isDirectory()) continue;

    for (const entry of readdirSync(typePath)) {
      const skillPath = join(typePath, entry);
      if (!lstatSync(skillPath).isDirectory()) continue;

      const skillFile = join(skillPath, "SKILL.md");
      if (!existsSync(skillFile) || !lstatSync(skillFile).isFile()) continue;

      const skillId = entry;

      if (seenIds.has(skillId)) {
        console.warn(`[luminae-helper] 警告：skillId "${skillId}" 在 commands/ 和 skills/ 中重复，优先使用 skills/ 下的条目`);
        continue;
      }
      seenIds.add(skillId);

      const content = readFileSync(skillFile, "utf-8");
      const { name, description } = parseSkillMeta(skillId, content);

      skills.push({
        id: skillId,
        name,
        description,
        sourceDir: skillPath,
        installTargets: generateInstallTargets(skillId),
      });
    }
  }

  return skills;
}

export const SKILLS = discoverSkills();

export function setSkillsSource(root) {
  SKILLS.splice(0, SKILLS.length, ...discoverSkills(root));
}

export function discoverInstalledSkills(tools = TOOLS) {
  const found = new Map();
  for (const tool of tools) {
    for (const mode of ["file", "dir"]) {
      const parent = mode === "file" ? tool.commandDir?.() : tool.skillDir?.();
      if (!parent || !existsSync(parent)) continue;
      for (const entry of readdirSync(parent)) {
        const dest = join(parent, entry);
        if (mode === "file" ? !entry.endsWith(".md") || !lstatSync(dest).isFile() : !lstatSync(dest).isDirectory()) continue;
        const file = mode === "file" ? dest : join(dest, "SKILL.md");
        if (!existsSync(file) || !lstatSync(file).isFile()) continue;
        const content = readFileSync(file, "utf8");
        if (!isManagedSkill(content)) continue;
        const id = mode === "file" ? entry.slice(0, -3) : entry;
        // A command and a skill with the same id may both be installed in one tool.
        const key = `${mode}:${id}`;
        if (!found.has(key)) found.set(key, { id: key, ...parseSkillMeta(id, content), legacyCommand: mode === "file", installTargets: [] });
        found.get(key).installTargets.push({ toolId: tool.id, installMode: mode, destPath: () => dest });
      }
    }
  }
  return [...found.values()];
}

export function useInstalledSkills() {
  SKILLS.splice(0, SKILLS.length, ...discoverInstalledSkills());
}

export function detectInstalledTools() {
  return TOOLS.map((tool) => ({
    ...tool,
    installed: commandExists(tool.command),
  }));
}
