import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { cleanupCache, leaseSource, withCacheLock } from "./cache-lifecycle.js";
import { discoverSkills } from "./constants.js";

const exec = promisify(execFile);
const DEFAULT_REPO = "https://github.com/evenweiss/ai-skills.git";
export function publicSourceOptions() {
  return { repo: DEFAULT_REPO, cacheDir: join(homedir(), ".cache", "luminae-helper", "public-skills") };
}
function optionsWithDefaults(options) {
  return { ...publicSourceOptions(), ...options };
}
async function git(args, cwd, timeout = 30000) {
  try {
    const { stdout } = await exec("git", args, {
      cwd, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", LC_ALL: "C" },
    });
    return stdout.trim();
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("找不到 Git。请先安装 Git（用于拉取技能与插件源码）。");
    throw error;
  }
}

// 把 git 的网络类失败归并成一句可操作提示，其余错误原样抛出。
function sourceError(error) {
  if (error?.message?.startsWith("找不到 Git")) return error;
  const text = String(error?.stderr || error?.stdout || error?.message || "");
  if (error?.killed || ["SIGTERM", "SIGKILL", "ETIMEDOUT"].includes(error?.signal) || /timed out/i.test(text)) {
    return new Error("无法获取技能仓库：网络或代理不可用（请求超时）。");
  }
  if (!/could not resolve|unable to access|connection (timed out|refused|reset)|network is unreachable|failed to connect|ssl|tls|early eof|rpc failed|the requested url returned/i.test(text)) return error;
  const reason = text.split("\n").map(line => line.trim()).filter(Boolean).at(-1)?.slice(0, 120) ?? "";
  return new Error(`无法获取技能仓库：网络或代理不可用${reason ? `（${reason}）` : ""}。`);
}
function publishDirectory(temp, destination) {
  try { renameSync(temp, destination); }
  catch (error) {
    // Another installer may have published this complete directory first.
    if (!["EEXIST", "ENOTEMPTY"].includes(error.code) || !existsSync(destination)) throw error;
  }
}
async function fetchTags(mirror) {
  for (let attempt = 0; ; attempt++) {
    try { return await git(["fetch", "--prune", "--no-tags", "origin", "refs/tags/*:refs/tags/*"], mirror); }
    catch (error) {
      const retryable = /cannot lock ref|Unable to create .*\.lock/.test(error.stderr || "")
        || error.killed || ["SIGTERM", "SIGKILL", "ETIMEDOUT"].includes(error.signal);
      if (attempt >= 2 || !retryable) throw error;
      await delay(200);
    }
  }
}
function stableTags(text) {
  return text.split("\n").filter(tag => /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    .sort((a, b) => {
      const av = a.replace(/^v/, "").split(".").map(BigInt);
      const bv = b.replace(/^v/, "").split(".").map(BigInt);
      for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? -1 : 1;
      return a.localeCompare(b);
    });
}
// Offline checks are synchronous so uninstall never needs a source fetch.
export function readCachedSource(options = {}) {
  const { repo, cacheDir } = optionsWithDefaults(options);
  try {
    const info = JSON.parse(readFileSync(join(cacheDir, "current.json"), "utf8"));
    if (info.repo !== repo || !/^[a-f0-9]{40,64}$/.test(info.commit) || stableTags(info.tag)[0] !== info.tag) return null;
    const root = join(resolve(cacheDir), "snapshots", info.commit);
    const run = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (run("rev-parse", "HEAD") !== info.commit || run("status", "--porcelain", "--untracked-files=all", "--ignored")) return null;
    if (discoverSkills(root).length === 0) return null;
    return { root, tag: info.tag, commit: info.commit };
  } catch { return null; }
}

export async function acquireCachedSource(options = {}) {
  const resolved = optionsWithDefaults(options);
  return withCacheLock(resolved.cacheDir, () => {
    const source = readCachedSource(resolved);
    const held = source ? leaseSource(resolved.cacheDir, source) : null;
    cleanupCache(resolved.cacheDir);
    return held;
  });
}

/**
 * 只读远端引用，不 clone/fetch，也不写缓存；用于启动时检查最新正式 Tag。
 */
export async function remotePublicTag(options = {}) {
  const { repo } = optionsWithDefaults(options);
  try {
    const output = await git(["ls-remote", "--tags", "--refs", repo], undefined, 8000);
    const tags = output.split("\n")
      .map(line => line.split(/\s+/)[1]?.replace(/^refs\/tags\//, ""))
      .filter(Boolean);
    const tag = stableTags(tags.join("\n"))[0];
    if (!tag) throw new Error("技能仓库没有正式版本 Tag");
    return tag;
  } catch (error) {
    throw sourceError(error);
  }
}

export async function latestPublicTag(options = {}) {
  const resolved = optionsWithDefaults(options);
  const cacheDir = resolve(resolved.cacheDir);
  const mirror = join(cacheDir, "repository.git");
  try {
    await withCacheLock(cacheDir, async () => {
      if (!existsSync(mirror)) {
        mkdirSync(cacheDir, { recursive: true });
        await git(["clone", "--bare", "--", resolved.repo, mirror]);
      } else {
        if (await git(["remote", "get-url", "origin"], mirror) !== resolved.repo) throw new Error("技能缓存来源不匹配");
        await fetchTags(mirror);
      }
    });
    const tag = stableTags(await git(["tag", "--list"], mirror))[0];
    if (!tag) throw new Error("技能仓库没有正式版本 Tag");
    return tag;
  } catch (error) {
    throw sourceError(error);
  }
}

export async function refreshPublicSource(options = {}) {
  const resolved = optionsWithDefaults(options);
  return withCacheLock(resolved.cacheDir, async () => {
    cleanupCache(resolved.cacheDir);
    try {
      const source = await refreshUnlocked(resolved);
      return leaseSource(resolved.cacheDir, source);
    } catch (error) {
      throw sourceError(error);
    } finally { cleanupCache(resolved.cacheDir); }
  });
}

async function refreshUnlocked(options) {
  const { repo, cacheDir } = optionsWithDefaults(options);
  mkdirSync(cacheDir, { recursive: true });
  const mirror = join(cacheDir, "repository.git");
  if (!existsSync(mirror)) {
    const temp = mkdtempSync(join(cacheDir, "clone-"));
    try {
      await git(["clone", "--bare", "--", repo, temp]);
      publishDirectory(temp, mirror);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  } else {
    if (await git(["remote", "get-url", "origin"], mirror) !== repo) throw new Error("技能缓存来源不匹配");
    await fetchTags(mirror);
  }
  if (await git(["remote", "get-url", "origin"], mirror) !== repo) throw new Error("技能缓存来源不匹配");
  const tag = stableTags(await git(["tag", "--list"], mirror))[0];
  if (!tag) throw new Error("技能仓库没有正式版本 Tag");
  const commit = await git(["rev-parse", `refs/tags/${tag}^{commit}`], mirror);
  const snapshots = join(resolve(cacheDir), "snapshots");
  mkdirSync(snapshots, { recursive: true });
  const root = join(snapshots, commit);
  if (!existsSync(root)) {
    const temp = mkdtempSync(join(snapshots, "checkout-"));
    try {
      await git(["clone", "--no-checkout", "--no-hardlinks", "--", resolve(mirror), temp]);
      await git(["checkout", "--detach", commit], temp);
      if (discoverSkills(temp).length === 0) throw new Error("正式版本没有可安装的技能");
      publishDirectory(temp, root);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
  if (await git(["rev-parse", "HEAD"], root) !== commit || await git(["status", "--porcelain", "--untracked-files=all", "--ignored"], root)) {
    throw new Error("技能快照已被修改，请保留本地改动并移走该快照后重试");
  }
  if (discoverSkills(root).length === 0) throw new Error("正式版本没有可安装的技能");
  const pointer = join(cacheDir, `current-${randomUUID()}.json`);
  try {
    writeFileSync(pointer, JSON.stringify({ repo, tag, commit }) + "\n");
    renameSync(pointer, join(cacheDir, "current.json"));
  } finally { rmSync(pointer, { force: true }); }
  return { root, tag, commit };
}
