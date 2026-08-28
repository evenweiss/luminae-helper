#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const strict = process.argv.includes("--strict");
const scriptDir = import.meta.dirname;
const packageRoot = join(scriptDir, "..");
const sourceRepo = process.env.LUMINAE_SKILLS_SOURCE || join(packageRoot, "..", "ai-skills");
const remote = process.env.LUMINAE_SKILLS_REPO || "https://github.com/evenweiss/ai-skills.git";
const copyDirs = ["commands", "skills"];
const skip = new Set(["node_modules", ".git", ".DS_Store", "Thumbs.db"]);

function hasSkillTree(root) {
  if (!existsSync(root)) return false;
  for (const name of readdirSync(root)) {
    const child = join(root, name);
    if (statSync(child).isDirectory() && existsSync(join(child, "SKILL.md"))) return true;
  }
  return false;
}

function copyDir(from, to) {
  rmSync(to, { recursive: true, force: true });
  if (!existsSync(from)) return false;
  cpSync(from, to, {
    recursive: true,
    filter: (src) => !skip.has(src.split(/[/\\]/).pop()),
  });
  return true;
}

function resolveSource() {
  // 优先拉取远端，失败时兜底用本地目录
  const tmp = mkdtempSync(join(tmpdir(), "luminae-skills-"));
  try {
    execFileSync("git", ["clone", "--depth", "1", remote, tmp], { stdio: "inherit" });
    return tmp;
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    if (copyDirs.some(d => hasSkillTree(join(sourceRepo, d)))) return sourceRepo;
    if (strict) throw e;
    return null;
  }
}

function main() {
  const srcRoot = resolveSource();
  if (!srcRoot) {
    if (copyDirs.some(d => hasSkillTree(join(packageRoot, d)))) {
      console.error("[fetch-skills] skipped: no source available, bundled skills already exist");
      return;
    }
    console.warn("[fetch-skills] warning: no source available and no bundled skills found");
    return;
  }

  let copied = 0;
  for (const dir of copyDirs) {
    const from = join(srcRoot, dir);
    const to = join(packageRoot, dir);
    if (hasSkillTree(from)) {
      copyDir(from, to);
      copied += 1;
      console.error(`[fetch-skills] copied ${dir}: ${from} -> ${to}`);
    } else {
      rmSync(to, { recursive: true, force: true });
      mkdirSync(to, { recursive: true });
    }
  }

  if (strict && copied === 0) {
    console.error("[fetch-skills] --strict: source contains no commands/ or skills/ entries");
    process.exit(1);
  }
}

main();
