import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withCacheLock } from "../src/lib/cache-lifecycle.js";

const helper = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(process.env.LUMINAE_AI_SKILLS_DIR || join(helper, "..", "ai-skills"));
const bundle = join(helper, "codex-plugins");
const build = join(helper, ".publish", "plugin-build");
const plugin = "ai-development-workflow";
const pluginPath = `./plugins/${plugin}`;
const marketplace = "luminae-helper";
const displayName = "Luminae Helper";
const excluded = new Set([".DS_Store", ".git", "__pycache__", "node_modules"]);

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function prepare() {
  const pluginDir = join(source, pluginPath);
  const catalogPaths = [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"];
  const catalogs = catalogPaths.map((path, index) => {
    const codex = index === 0;
    const catalog = readJson(join(source, path));
    const entry = catalog.plugins.find(item => item.name === plugin);
    const entryPath = codex ? entry?.source?.path : entry?.source;
    const manifest = readJson(join(pluginDir, codex ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json"));
    if (entryPath !== pluginPath || (codex && entry.source.source !== "local") || manifest.name !== plugin || !manifest.version) {
      throw new Error(`插件清单与源码目录不一致：${path}`);
    }
    const metadata = codex
      ? { interface: { ...catalog.interface, displayName } }
      : { owner: { ...catalog.owner, name: displayName }, description: "Luminae Helper 随包分发的插件" };
    return { path, manifest, data: { name: marketplace, ...metadata, plugins: [entry] } };
  });
  if (catalogs[0].manifest.version !== catalogs[1].manifest.version) {
    throw new Error("Codex 和 Claude Code 的插件版本不一致。");
  }
  readFileSync(join(pluginDir, "skills", plugin, "SKILL.md"));

  const staging = mkdtempSync(join(build, "stage-"));
  const prepared = join(staging, "source");
  const previous = join(staging, "previous");
  let preserveBackup = false;
  try {
    const destination = join(prepared, pluginPath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(pluginDir, destination, {
      recursive: true,
      filter: path => !excluded.has(basename(path)) && !lstatSync(path).isSymbolicLink(),
    });
    for (const { path, data } of catalogs) {
      const file = join(prepared, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    }
    const hadBundle = lstatSync(bundle, { throwIfNoEntry: false }) !== undefined;
    if (hadBundle) renameSync(bundle, previous);
    try { renameSync(prepared, bundle); }
    catch (error) {
      if (hadBundle) {
        try { renameSync(previous, bundle); }
        catch { preserveBackup = true; throw new Error(`旧插件包已保留于 ${previous}`); }
      }
      throw error;
    }
  } finally {
    if (!preserveBackup) rmSync(staging, { recursive: true, force: true });
  }
}

try {
  await withCacheLock(build, prepare);
} catch (error) {
  console.error(`无法从 ${source} 生成插件包：${error.message}。请核对 ai-skills 检出目录或 LUMINAE_AI_SKILLS_DIR。`);
  process.exitCode = 1;
}
