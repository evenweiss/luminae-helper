import { existsSync, lstatSync, mkdirSync, mkdtempSync, copyFileSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getSkillSourcePath } from "./constants.js";
import { isManagedSkill, withManagedBy } from "./managed-by.js";

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  ensureDir(dest);
  copyFileSync(src, dest);
}

/** 目录名黑名单：复制 skill 目录时跳过这些条目，避免污染用户 home */
const COPY_SKIP_ENTRIES = new Set(["node_modules", ".git", ".DS_Store", "Thumbs.db", "README.md"]);

function copyDir(src, dest, managedContent) {
  ensureDir(dest);
  const tmpDest = mkdtempSync(dest + ".__tmp__");
  const backupDest = tmpDest + ".__bak__";
  let hasBackup = false;
  let committed = false;
  try {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (COPY_SKIP_ENTRIES.has(entry.name) || entry.isSymbolicLink()) continue;
      const srcPath = join(src, entry.name);
      const destPath = join(tmpDest, entry.name);
      if (entry.isDirectory()) copyDir(srcPath, destPath);
      else copyFile(srcPath, destPath);
    }
    if (managedContent !== undefined) writeFileSync(join(tmpDest, "SKILL.md"), managedContent, "utf8");
    if (lstatSync(dest, { throwIfNoEntry: false })) {
      renameSync(dest, backupDest);
      hasBackup = true;
    }
    renameSync(tmpDest, dest);
    committed = true;
  } catch (error) {
    if (hasBackup && !lstatSync(dest, { throwIfNoEntry: false })) {
      try { renameSync(backupDest, dest); }
      catch { throw new Error(`安装失败，旧内容保留于 ${backupDest}`); }
    }
    throw error;
  } finally {
    if (existsSync(tmpDest)) rmSync(tmpDest, { recursive: true, force: true });
    if (committed && hasBackup) rmSync(backupDest, { recursive: true, force: true });
  }
}

/** Only regular managed copies belong to the public installer; links have separate owners. */
function isInstalledByUs(destPath, isDirBased) {
  try {
    const stat = lstatSync(destPath);
    if (isDirBased ? !stat.isDirectory() : !stat.isFile()) return false;
    const file = isDirBased ? join(destPath, "SKILL.md") : destPath;
    return lstatSync(file).isFile() && isManagedSkill(readFileSync(file, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Install a skill to a specific tool destination.
 * @param {object} skill - skill object from constants.js
 * @param {object} tool - tool object from constants.js
 * @returns {{ success: boolean, message: string }}
 */
export function installSkillToTool(skill, tool) {
  // Look up the correct target from installTargets
  const target = skill.installTargets?.find(tgt => tgt.toolId === tool.id);
  if (!target) {
    return { success: false, message: `Skill does not support ${tool.name}` };
  }

  let sourceDir;
  try {
    sourceDir = getSkillSourcePath(skill.id);
  } catch (e) {
    return { success: false, message: e.message };
  }

  if (!existsSync(sourceDir)) {
    return { success: false, message: `Skill source not found: ${sourceDir}` };
  }

  const destPath = target.destPath();
  const isDirBased = target.installMode === "dir";

  try {
    if (lstatSync(destPath, { throwIfNoEntry: false }) && !isInstalledByUs(destPath, isDirBased)) {
      return { success: false, skipped: true, message: `目标已存在且非本工具安装，已跳过: ${destPath}` };
    }
    const srcSkillFile = join(sourceDir, "SKILL.md");
    if (!lstatSync(srcSkillFile).isFile()) throw new Error("SKILL.md must be a regular file");
    const managedContent = withManagedBy(readFileSync(srcSkillFile, "utf8"));
    if (isDirBased) {
      copyDir(sourceDir, destPath, managedContent);
    } else {
      ensureDir(destPath);
      const stagingDir = mkdtempSync(destPath + ".__tmp__");
      try {
        const stagedFile = join(stagingDir, "content.md");
        copyFileSync(srcSkillFile, stagedFile);
        writeFileSync(stagedFile, managedContent, "utf8");
        renameSync(stagedFile, destPath);
      } finally {
        rmSync(stagingDir, { recursive: true, force: true });
      }
    }
    return { success: true, message: `Installed to ${destPath}` };
  } catch (error) {
    return { success: false, message: `安装失败: ${error.message}` };
  }
}

/**
 * Uninstall a skill from a specific tool.
 */
export function uninstallSkillFromTool(skill, tool) {
  const target = skill.installTargets?.find(tgt => tgt.toolId === tool.id);
  if (!target) {
    return { success: false, message: `Skill does not support ${tool.name}` };
  }

  let destPath;
  try {
    destPath = target.destPath();
  } catch (e) {
    return { success: false, message: e.message };
  }
  const isDirBased = target.installMode === "dir";

  if (!isInstalledByUs(destPath, isDirBased)) {
    if (existsSync(destPath)) {
      return { success: false, message: `目标路径 ${destPath} 存在但非本工具安装，已跳过删除` };
    }
    return { success: false, message: "Not installed" };
  }

  if (isDirBased) {
    try {
      rmSync(destPath, { recursive: true, force: true });
    } catch (e) {
      return { success: false, message: `卸载失败: ${e.message}` };
    }
    return { success: true, message: `Uninstalled from ${destPath}` };
  } else {
    try {
      unlinkSync(destPath);
    } catch (e) {
      return { success: false, message: `卸载失败: ${e.message}` };
    }
    return { success: true, message: `Uninstalled from ${destPath}` };
  }
}
