import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as source from "../src/lib/public-source.js";

const children = [];
const roots = [];
async function startChild(code) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  let errors = ""; child.stderr.on("data", chunk => { errors += chunk; });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("child timeout: " + errors)), 7000);
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; if (output.includes("\n")) { clearTimeout(timer); resolve(JSON.parse(output.split("\n")[0])); } });
    child.on("exit", code => { clearTimeout(timer); if (!output.includes("\n")) reject(new Error(`child exit ${code}: ${errors}`)); });
  });
  return { child, ready };
}
afterEach(() => { for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "public-source-test-"));
  roots.push(root);
  const repo = join(root, "remote");
  mkdirSync(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "commit.gpgsign", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "tag.gpgsign", GIT_CONFIG_VALUE_1: "false" } }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  const commit = (body) => {
    mkdirSync(join(repo, "skills", "demo"), { recursive: true });
    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), `---\nname: demo\ndescription: demo\n---\n${body}\n`);
    git("add", "."); git("commit", "-qm", body);
    return git("rev-parse", "HEAD");
  };
  return { root, repo, git, commit, options: { repo, cacheDir: join(root, "cache") } };
}

describe("public skill source", () => {
  it("selects the highest numeric stable tag, peels annotated tags, ignores main and prereleases", async () => {
    const f = fixture();
    f.commit("older"); f.git("tag", "0.9.0");
    const expected = f.commit("release"); f.git("tag", "--no-sign", "-am", "release", "v0.10.0");
    f.commit("unreleased"); f.git("tag", "1.0.0-beta.1"); f.git("tag", "notes");
    const result = await source.refreshPublicSource(f.options);
    expect(result.tag).toBe("v0.10.0"); expect(result.commit).toBe(expected);
    expect(readFileSync(join(result.root, "skills/demo/SKILL.md"), "utf8")).toContain("release");
    expect(readFileSync(join(result.root, "skills/demo/SKILL.md"), "utf8")).not.toContain("unreleased");
  });
  it("fetches a later release without changing the snapshot in use", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0");
    const first = await source.refreshPublicSource(f.options);
    f.commit("second"); f.git("tag", "0.2.0");
    const second = await source.refreshPublicSource(f.options);
    expect(second.tag).toBe("0.2.0"); expect(second.root).not.toBe(first.root);
    expect(readFileSync(join(first.root, "skills/demo/SKILL.md"), "utf8")).toContain("first");
    expect(source.readCachedSource(f.options).commit).toBe(second.commit);
  });
  it("reports network failure but retains an explicitly readable validated cache", async () => {
    const f = fixture(); f.commit("cached"); f.git("tag", "0.1.0");
    const first = await source.refreshPublicSource(f.options);
    rmSync(f.repo, { recursive: true });
    await expect(source.refreshPublicSource(f.options)).rejects.toThrow();
    expect(source.readCachedSource(f.options).commit).toBe(first.commit);
    writeFileSync(join(first.root, "skills/demo/SKILL.md"), "modified");
    expect(source.readCachedSource(f.options)).toBeNull();
  });
  it("ignores deleted remote tags when refreshing", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0"); f.git("tag", "9.0.0");
    await source.refreshPublicSource(f.options); f.git("tag", "-d", "9.0.0");
    expect((await source.refreshPublicSource(f.options)).tag).toBe("0.1.0");
  });
  it("refuses to refresh over a modified snapshot", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0");
    const first = await source.refreshPublicSource(f.options);
    writeFileSync(join(first.root, "skills/demo/SKILL.md"), "keep local edit");
    await expect(source.refreshPublicSource(f.options)).rejects.toThrow("快照已被修改");
    expect(readFileSync(join(first.root, "skills/demo/SKILL.md"), "utf8")).toBe("keep local edit");
  });
  it("allows concurrent first installs and concurrent release refreshes to share the cache", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0");
    const first = await Promise.allSettled([source.refreshPublicSource(f.options), source.refreshPublicSource(f.options)]);
    expect(first.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
    f.commit("second"); f.git("tag", "0.2.0");
    const second = await Promise.allSettled([source.refreshPublicSource(f.options), source.refreshPublicSource(f.options)]);
    expect(second.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(second.map(r => r.value.tag)).toEqual(["0.2.0", "0.2.0"]);
  });
  it("keeps only current and leased snapshots, pruning history after the last release", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0");
    const first = await source.refreshPublicSource(f.options);
    const reader = await source.acquireCachedSource(f.options);
    f.commit("second"); f.git("tag", "0.2.0");
    const second = await source.refreshPublicSource(f.options);
    await first.release();
    expect(existsSync(first.root)).toBe(true);
    await reader.release();
    expect(existsSync(first.root)).toBe(false);
    await second.release(); await second.release();
    expect(readdirSync(join(f.options.cacheDir, "snapshots"))).toEqual([second.commit]);
    expect(source.readCachedSource(f.options).commit).toBe(second.commit);
    expect(readdirSync(join(f.options.cacheDir, "leases"))).toEqual([]);
  });
  it("cleans abandoned temporary data even when the next refresh fails", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0");
    const first = await source.refreshPublicSource(f.options); await first.release();
    const junk = [join(f.options.cacheDir, "clone-abandoned"), join(f.options.cacheDir, "snapshots/checkout-abandoned")];
    for (const path of junk) mkdirSync(path);
    writeFileSync(join(f.options.cacheDir, "current-abandoned.json"), "incomplete");
    writeFileSync(join(f.options.cacheDir, "unrelated.txt"), "keep");
    rmSync(f.repo, { recursive: true });
    await expect(source.refreshPublicSource(f.options)).rejects.toThrow();
    for (const path of junk) expect(existsSync(path)).toBe(false);
    expect(existsSync(join(f.options.cacheDir, "current-abandoned.json"))).toBe(false);
    expect(readFileSync(join(f.options.cacheDir, "unrelated.txt"), "utf8")).toBe("keep");
    expect(source.readCachedSource(f.options).commit).toBe(first.commit);
  });
  it("preserves local edits in an idle old snapshot", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0");
    const first = await source.refreshPublicSource(f.options);
    writeFileSync(join(first.root, "skills/demo/SKILL.md"), "local edit");
    f.commit("second"); f.git("tag", "0.2.0");
    const second = await source.refreshPublicSource(f.options);
    await first.release(); await second.release();
    expect(readFileSync(join(first.root, "skills/demo/SKILL.md"), "utf8")).toBe("local edit");
  });
  it("keeps a different process's active snapshot until that process finishes", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0");
    const module = pathToFileURL(join(import.meta.dirname, "../src/lib/public-source.js")).href;
    const { child, ready } = await startChild(`
      import { refreshPublicSource } from ${JSON.stringify(module)};
      const held = await refreshPublicSource(${JSON.stringify(f.options)});
      console.log(JSON.stringify({ root: held.root }));
      await new Promise(resolve => process.stdin.once("data", resolve));
      await held.release();
    `);
    f.commit("second"); f.git("tag", "0.2.0");
    const second = await source.refreshPublicSource(f.options); await second.release();
    expect(existsSync(ready.root)).toBe(true);
    const exited = once(child, "exit"); child.stdin.end("release"); await exited;
    expect(existsSync(ready.root)).toBe(false);
    expect(readdirSync(join(f.options.cacheDir, "snapshots"))).toEqual([second.commit]);
  });
  it("reclaims a crashed reader's lease and an abandoned operation lock", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0");
    const module = pathToFileURL(join(import.meta.dirname, "../src/lib/public-source.js")).href;
    const lifecycle = pathToFileURL(join(import.meta.dirname, "../src/lib/cache-lifecycle.js")).href;
    const { child, ready } = await startChild(`
      import { refreshPublicSource } from ${JSON.stringify(module)};
      import { withCacheLock } from ${JSON.stringify(lifecycle)};
      const held = await refreshPublicSource(${JSON.stringify(f.options)});
      await withCacheLock(${JSON.stringify(f.options.cacheDir)}, async () => {
        console.log(JSON.stringify({ root: held.root }));
        await new Promise(resolve => process.stdin.once("data", resolve));
      });
    `);
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    f.commit("second"); f.git("tag", "0.2.0");
    const second = await source.refreshPublicSource(f.options); await second.release();
    expect(existsSync(ready.root)).toBe(false);
    expect(readdirSync(join(f.options.cacheDir, "leases"))).toEqual([]);
    expect(existsSync(join(f.options.cacheDir, "operation.lock"))).toBe(false);
  });
  it("preserves an old snapshot whose local HEAD changed even if its working tree is clean", async () => {
    const f = fixture(); f.commit("first"); f.git("tag", "0.1.0");
    const first = await source.refreshPublicSource(f.options);
    writeFileSync(join(first.root, "skills/demo/SKILL.md"), "local committed work");
    execFileSync("git", ["add", "."], { cwd: first.root });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--no-gpg-sign", "-qm", "local work"], { cwd: first.root });
    f.commit("second"); f.git("tag", "0.2.0");
    const second = await source.refreshPublicSource(f.options); await first.release(); await second.release();
    expect(existsSync(first.root)).toBe(true);
  });
  it("does not accept another remote's cached source", async () => {
    const f = fixture(); f.commit("cached"); f.git("tag", "0.1.0");
    await source.refreshPublicSource(f.options);
    expect(source.readCachedSource({ ...f.options, repo: join(f.root, "other") })).toBeNull();
  });
  it("fails a first download and a repo without stable tags without creating a usable cache", async () => {
    const f = fixture(); f.commit("untagged");
    await expect(source.refreshPublicSource(f.options)).rejects.toThrow();
    expect(source.readCachedSource(f.options)).toBeNull();
    await expect(source.refreshPublicSource({ ...f.options, repo: join(f.root, "missing") })).rejects.toThrow();
    expect(existsSync(join(f.options.cacheDir, "current.json"))).toBe(false);
  });
});
