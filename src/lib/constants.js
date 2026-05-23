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
  {
    id: "trae",
    name: "Trae",
    command: "trae",
    commandDir: () => join(homedir(), ".trae", "commands"),
    skillDir: null,
    installHint: "Download from https://trae.ai",
  },
];

// ── Skill auto-discovery ──

/**
 * Get the package root directory.
 * import.meta.dirname = <luminae-helper>/src/lib
 * Package root = <luminae-helper>/
 */
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

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Only extracts `name` and `description`.
 */
function parseSkillMeta(skillId, content) {
  let name = null;
  let description = null;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)/);
      if (m) {
        let value = m[2].trim();
        // Strip YAML inline comments (unquoted # after value)
        // But preserve # inside quoted strings
        if (!((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'")))) {
          const hashIdx = value.indexOf(" #");
          if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
        }
        // Strip surrounding quotes (single or double) from YAML values
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (m[1] === "name") name = value;
        if (m[1] === "description") description = value;
      }
    }
  }

  // Default name: skillId, capitalize words separated by hyphens
  if (!name) {
    name = skillId
      .replace(/(^|-)(\w)/g, (_, p, c) => (p === "-" ? " " : "") + c.toUpperCase());
  }

  // Default description: first blockquote line
  if (!description) {
    const bq = content.match(/^>\s*(.+)/m);
    if (bq) description = bq[1].trim();
  }

  return { name, description };
}

/**
 * Generate installTargets for an entry based on tool capability.
 * - skillType "command" + tool supports commandDir → file mode (commands/)
 * - skillType "command" + tool only supports skillDir → fallback dir mode
 * - skillType "skill"   + tool supports skillDir   → dir mode (skills/)
 * - skillType "skill"   + tool only supports commandDir → fallback file mode
 * - tool supports neither → skip
 */
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
        // Fallback: tool only supports skills, install command as skill
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
        // Fallback: tool only supports commands, install skill as command
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

/**
 * Scan commands/ and skills/ directories and build SKILLS array automatically.
 * Each subdirectory containing a SKILL.md is a valid skill.
 * - commands/<skillId>/ → type: "command"
 * - skills/<skillId>/   → type: "skill"
 */
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

// ── Helpers ──

/**
 * Detect which tools are installed on this machine.
 */
export function detectInstalledTools() {
  return TOOLS.map((tool) => ({
    ...tool,
    installed: commandExists(tool.command),
  }));
}

/**
 * Find skill source directory bundled inside this package.
 * - command: <luminae-helper>/commands/<skillId>/
 * - skill:   <luminae-helper>/skills/<skillId>/
 */
export function getSkillSourcePath(skillId) {
  const skill = SKILLS.find(s => s.id === skillId);
  if (!skill) {
    throw new Error(`Unknown skillId: "${skillId}" — not found in discovered skills`);
  }
  const subDir = skill.type === "command" ? "commands" : "skills";
  return join(getPackageDir(), subDir, skillId);
}
