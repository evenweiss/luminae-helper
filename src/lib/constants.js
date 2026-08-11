import { homedir } from "os";
import { join } from "path";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
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

function generateInstallTargets(skillId, skillType) {
  const targets = [];
  for (const tool of TOOLS) {
    const supportsCommand = Boolean(tool.commandDir);
    const supportsSkill = Boolean(tool.skillDir);

    if (skillType === "command") {
      if (supportsCommand) {
        targets.push({
          toolId: tool.id,
          installMode: "file",
          conversion: null,
          destPath: () => join(tool.commandDir(), `${skillId}.md`),
        });
      } else if (supportsSkill) {
        targets.push({
          toolId: tool.id,
          installMode: "dir",
          conversion: "command-to-skill",
          destPath: () => join(tool.skillDir(), skillId),
        });
      }
    } else if (skillType === "skill") {
      if (supportsSkill) {
        targets.push({
          toolId: tool.id,
          installMode: "dir",
          conversion: null,
          destPath: () => join(tool.skillDir(), skillId),
        });
      } else if (supportsCommand) {
        targets.push({
          toolId: tool.id,
          installMode: "file",
          conversion: "skill-to-command",
          destPath: () => join(tool.commandDir(), `${skillId}.md`),
        });
      }
    }
  }
  return targets;
}

export function discoverSkills() {
  const packageDir = getPackageDir();
  const skills = [];

  const typeDirs = [
    { dir: "commands", type: "command" },
    { dir: "skills", type: "skill" },
  ];

  const seenIds = new Set();

  for (const { dir, type } of typeDirs) {
    const typePath = join(packageDir, dir);
    if (!existsSync(typePath)) continue;

    for (const entry of readdirSync(typePath)) {
      const skillPath = join(typePath, entry);
      if (!statSync(skillPath).isDirectory()) continue;

      const skillFile = join(skillPath, "SKILL.md");
      if (!existsSync(skillFile)) continue;

      const skillId = entry;

      if (seenIds.has(skillId)) {
        console.warn(`[luminae-helper] 警告：skillId "${skillId}" 在 commands/ 和 skills/ 中重复，仅使用 commands/ 下的条目`);
        continue;
      }
      seenIds.add(skillId);

      const content = readFileSync(skillFile, "utf-8");
      const { name, description } = parseSkillMeta(skillId, content);

      skills.push({
        id: skillId,
        name,
        description,
        type,
        installTargets: generateInstallTargets(skillId, type),
      });
    }
  }

  return skills;
}

export const SKILLS = discoverSkills();

export function detectInstalledTools() {
  return TOOLS.map((tool) => ({
    ...tool,
    installed: commandExists(tool.command),
  }));
}

export function getSkillSourcePath(skillId) {
  const skill = SKILLS.find(s => s.id === skillId);
  if (!skill) {
    throw new Error(`Unknown skillId: "${skillId}" — not found in discovered skills`);
  }
  const subDir = skill.type === "command" ? "commands" : "skills";
  return join(getPackageDir(), subDir, skillId);
}
