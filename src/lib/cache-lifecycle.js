import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}
function ownerPid(name) {
  const match = name.match(/^([1-9]\d*)-[a-f0-9-]{36}\.owner$/);
  return match ? Number(match[1]) : null;
}
function removeOwner(directory, name) {
  try { unlinkSync(join(directory, name)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  // Never recursively delete a shared lock: a new owner may already be here.
  try { rmdirSync(directory); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
}
function reapDeadLock(directory) {
  try {
    for (const name of readdirSync(directory)) {
      const pid = ownerPid(name);
      if (pid !== null && !isAlive(pid)) removeOwner(directory, name);
    }
    try { rmdirSync(directory); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
export async function withCacheLock(cacheDir, action) {
  mkdirSync(cacheDir, { recursive: true });
  const identity = `${process.pid}-${randomUUID()}`;
  const waiting = join(cacheDir, `lock-${identity}`);
  mkdirSync(waiting);
  const owner = `${identity}.owner`;
  const lock = join(cacheDir, "operation.lock");
  try {
    writeFileSync(join(waiting, owner), "");
    const deadline = Date.now() + 120000;
    while (true) {
      try { renameSync(waiting, lock); break; }
      catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
        reapDeadLock(lock);
        if (Date.now() >= deadline) throw new Error("公共技能缓存正在更新，请稍后重试");
        await delay(50);
      }
    }
    try { return await action(); }
    finally { removeOwner(lock, owner); }
  } finally { rmSync(waiting, { recursive: true, force: true }); }
}
function activeCommits(cacheDir) {
  const directory = join(cacheDir, "leases");
  mkdirSync(directory, { recursive: true });
  const active = new Set();
  for (const name of readdirSync(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const path = join(directory, name);
    let lease;
    try { lease = JSON.parse(readFileSync(path, "utf8")); } catch { rmSync(path, { force: true }); continue; }
    if (isAlive(lease.pid)) {
      if (/^[a-f0-9]{40,64}$/.test(lease.commit)) active.add(lease.commit);
    } else { rmSync(path, { force: true }); }
  }
  return active;
}
// All lifecycle mutations, including lease registration, run under the same short lock.
export function cleanupCache(cacheDir) {
  const active = activeCommits(cacheDir);
  for (const name of readdirSync(cacheDir)) {
    if (/^clone-[\w-]+$/.test(name) || /^current-[\w-]+\.json$/.test(name)) rmSync(join(cacheDir, name), { recursive: true, force: true });
    const waiting = name.match(/^lock-([1-9]\d*)-[a-f0-9-]{36}$/);
    if (waiting && !isAlive(Number(waiting[1]))) rmSync(join(cacheDir, name), { recursive: true, force: true });
  }
  let current;
  try { current = JSON.parse(readFileSync(join(cacheDir, "current.json"), "utf8")).commit; } catch { /* Keep snapshots if the pointer cannot be read. */ }
  const directory = join(cacheDir, "snapshots");
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (/^checkout-[\w-]+$/.test(name)) { rmSync(path, { recursive: true, force: true }); continue; }
    if (!/^[a-f0-9]{40,64}$/.test(current || "") || !/^[a-f0-9]{40,64}$/.test(name) || name === current || active.has(name)) continue;
    if (!lstatSync(path).isDirectory()) continue;
    try {
      const run = args => execFileSync("git", args, { cwd: path, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim();
      if (run(["rev-parse", "HEAD"]) !== name || run(["status", "--porcelain", "--untracked-files=all", "--ignored"])) {
        console.warn(`公共技能旧快照包含本地修改，已保留：${path}`);
        continue;
      }
    } catch { console.warn(`公共技能旧快照无法验证，已保留：${path}`); continue; }
    rmSync(path, { recursive: true, force: true });
  }
}
export function leaseSource(cacheDir, source) {
  const directory = join(cacheDir, "leases");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify({ pid: process.pid, commit: source.commit }));
  let released = false;
  return {
    ...source,
    async release() {
      if (released) return;
      await withCacheLock(cacheDir, () => {
        rmSync(path, { force: true });
        cleanupCache(cacheDir);
        released = true;
      });
    },
  };
}
