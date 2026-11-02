import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { discoverSkills } from "./constants.js";

const exec = promisify(execFile);
const DEFAULT_REPO = "https://github.com/evenweiss/ai-skills.git";
export function publicSourceOptions() {
  return { repo: DEFAULT_REPO, cacheDir: join(homedir(), ".cache", "luminae-helper", "public-skills") };
}
function optionsWithDefaults(options) {
  return { ...publicSourceOptions(), ...options };
}
async function git(args, cwd) {
  const { stdout } = await exec("git", args, {
    cwd, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", LC_ALL: "C" },
  });
  return stdout.trim();
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
      if (attempt >= 2 || !/cannot lock ref|Unable to create .*\.lock/.test(error.stderr || "")) throw error;
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

export async function refreshPublicSource(options = {}) {
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
    if (await git(["remote", "get-url", "origin"], mirror) !== repo) throw new Error("公共技能缓存来源不匹配");
    await fetchTags(mirror);
  }
  if (await git(["remote", "get-url", "origin"], mirror) !== repo) throw new Error("公共技能缓存来源不匹配");
  const tag = stableTags(await git(["tag", "--list"], mirror))[0];
  if (!tag) throw new Error("公共技能仓库没有正式版本 Tag");
  const commit = await git(["rev-parse", `refs/tags/${tag}^{commit}`], mirror);
  const snapshots = join(resolve(cacheDir), "snapshots");
  mkdirSync(snapshots, { recursive: true });
  const root = join(snapshots, commit);
  if (!existsSync(root)) {
    const temp = mkdtempSync(join(snapshots, "checkout-"));
    try {
      await git(["clone", "--no-checkout", "--no-hardlinks", "--", resolve(mirror), temp]);
      await git(["checkout", "--detach", commit], temp);
      if (discoverSkills(temp).length === 0) throw new Error("正式版本没有可安装的公共技能");
      publishDirectory(temp, root);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
  if (await git(["rev-parse", "HEAD"], root) !== commit || await git(["status", "--porcelain", "--untracked-files=all", "--ignored"], root)) {
    throw new Error("公共技能快照已被修改，请保留本地改动并移走该快照后重试");
  }
  if (discoverSkills(root).length === 0) throw new Error("正式版本没有可安装的公共技能");
  const pointer = join(cacheDir, `current-${randomUUID()}.json`);
  try {
    writeFileSync(pointer, JSON.stringify({ repo, tag, commit }) + "\n");
    renameSync(pointer, join(cacheDir, "current.json"));
  } finally { rmSync(pointer, { force: true }); }
  return { root, tag, commit };
}
