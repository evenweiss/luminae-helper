import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getSkillSourcePath } from "./constants.js";

// ── managed-by 标识 ──

const MANAGED_BY = "luminae-helper";
const MANAGED_LINE = `managed-by: ${MANAGED_BY}`;

/**
 * 在 SKILL.md 内容的 YAML frontmatter 中注入 `managed-by: luminae-helper`。
 * - 如果 frontmatter 中已有该行，不重复添加。
 * - 如果没有 frontmatter（理论上不会发生），在文件开头创建一个。
 */
function injectManagedBy(content) {
  if (content.includes(MANAGED_LINE)) return content;
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    // 在 frontmatter 关闭的 --- 前插入一行
    return content.replace(/\n---\n/, `\n${MANAGED_LINE}\n---\n`);
  }
  // 无 frontmatter：包一层
  return `---\n${MANAGED_LINE}\n---\n${content}`;
}

/**
 * 检查 SKILL.md 内容是否包含 `managed-by: luminae-helper` 标识。
 */
function hasManagedBy(content) {
  return content.includes(MANAGED_LINE);
}

/**
 * 向目标文件注入 managed-by 标识（原地修改）。
 * 读取文件内容，注入标识后写回。
 */
function stampManagedBy(filePath) {
  try {
    if (!existsSync(filePath)) return;
    const content = readFileSync(filePath, "utf-8");
    const stamped = injectManagedBy(content);
    if (stamped !== content) {
      writeFileSync(filePath, stamped, "utf-8");
    }
  } catch {
    // 注入失败不阻塞安装流程，只是卸载时无法识别
  }
}

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
const COPY_SKIP_ENTRIES = new Set(["node_modules", ".git", ".DS_Store", "Thumbs.db"]);

function copyDir(src, dest) {
  if (!existsSync(src)) throw new Error(`Source dir not found: ${src}`);
  // 先拷贝到临时目录，成功后原子替换，避免中途失败导致数据丢失
  const tmpDest = dest + ".__tmp__";
  if (existsSync(tmpDest)) {
    rmSync(tmpDest, { recursive: true, force: true });
  }
  mkdirSync(tmpDest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (COPY_SKIP_ENTRIES.has(entry.name)) continue;
    const srcPath = join(src, entry.name);
    const destPath = join(tmpDest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
  // 临时目录拷贝完成，替换目标
  // 先备份旧目标，rename 失败时可恢复
  const backupDest = dest + ".__bak__";
  let hasBackup = false;
  if (existsSync(dest)) {
    try {
      renameSync(dest, backupDest);
      hasBackup = true;
    } catch {
      // 无法重命名旧目录，直接删除
      rmSync(dest, { recursive: true, force: true });
    }
  }
  try {
    renameSync(tmpDest, dest);
  } catch (e) {
    // 替换失败：尝试恢复备份
    if (hasBackup && existsSync(backupDest)) {
      try { renameSync(backupDest, dest); } catch { /* 恢复也失败，无法做更多 */ }
    }
    // 清理临时目录
    if (existsSync(tmpDest)) rmSync(tmpDest, { recursive: true, force: true });
    throw new Error(`替换目标目录失败: ${e.message}`);
  }
  // 成功后清理备份
  if (hasBackup && existsSync(backupDest)) {
    rmSync(backupDest, { recursive: true, force: true });
  }
}

/**
 * 检查目标路径是否由本工具安装（SKILL.md / .md 文件中包含 `managed-by: luminae-helper`），
 * 避免误删用户手动创建或 AI 工具自带的同名文件/目录。
 */
function isInstalledByUs(destPath, isDirBased) {
  if (!existsSync(destPath)) return false;
  try {
    if (isDirBased) {
      // dir 模式：检查目录下 SKILL.md 是否含 managed-by 标识
      const skillFile = join(destPath, "SKILL.md");
      if (!existsSync(skillFile)) return false;
      const content = readFileSync(skillFile, "utf-8");
      return hasManagedBy(content);
    } else {
      // file 模式：检查 .md 文件内容是否含 managed-by 标识
      const stat = statSync(destPath);
      if (!stat.isFile() || stat.size === 0) return false;
      const content = readFileSync(destPath, "utf-8");
      return hasManagedBy(content);
    }
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

  if (isDirBased) {
    try {
      copyDir(sourceDir, destPath);
    } catch (e) {
      return { success: false, message: `安装失败: ${e.message}` };
    }
    // 注入 managed-by 标识到目标 SKILL.md
    stampManagedBy(join(destPath, "SKILL.md"));
    return { success: true, message: `Installed to ${destPath}` };
  } else {
    const srcSkillFile = join(sourceDir, "SKILL.md");
    if (!existsSync(srcSkillFile)) {
      return { success: false, message: `SKILL.md not found in ${sourceDir}` };
    }
    try {
      copyFile(srcSkillFile, destPath);
    } catch (e) {
      return { success: false, message: `安装失败: ${e.message}` };
    }
    // 注入 managed-by 标识到目标 .md 文件
    stampManagedBy(destPath);
    return { success: true, message: `Installed to ${destPath}` };
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
