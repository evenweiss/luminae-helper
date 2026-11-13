import { execFile } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withCacheLock } from "./cache-lifecycle.js";

const exec = promisify(execFile);
const hosts = {
  codex: { label: "Codex", command: "codex", catalogs: [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"], manifests: [".codex-plugin/plugin.json", "plugin.json"], install: "add" },
  "claude-code": { label: "Claude Code", command: "claude", catalogs: [".claude-plugin/marketplace.json"], manifests: [".claude-plugin/plugin.json"], install: "install" },
};
export const PLUGIN_HOSTS = Object.keys(hosts);
function hostConfig(host) {
  if (!PLUGIN_HOSTS.includes(host)) throw new Error(`不支持插件宿主 ${host}。可用宿主：${PLUGIN_HOSTS.join("、")}`);
  return hosts[host];
}
const idPart = /^[a-z0-9][a-z0-9._-]*$/i;
const usage = "用法：luminae-helper plugin install <技能名> [--tool codex|claude-code] [--source <本地包目录>]";
const managedName = "luminae-helper";
const managedBundle = fileURLToPath(new URL("../../codex-plugins/", import.meta.url));
const sourceMarker = ".luminae-helper-marketplace";

async function pluginExecutable({ command, label }) {
  if (process.platform !== "win32") return [command];

  const { stdout } = await exec("where.exe", [command], { windowsHide: true, timeout: 5000 });
  for (const filename of stdout.split(/\r?\n/).filter(Boolean)) {
    const extension = extname(filename).toLowerCase();
    if (extension === ".exe") return [filename];
    if (command === "codex" && extension === ".cmd") {
      const binDir = dirname(filename);
      // npm's .cmd shim is not directly executable without a shell.
      const entry = [join(binDir, "node_modules"), dirname(binDir)]
        .map(modules => join(modules, "@openai/codex/bin/codex.js")).find(existsSync);
      if (entry) return [process.execPath, entry];
    }
  }
  throw new Error(`找不到可运行的 ${label} CLI。`);
}

async function nativeJson(host, args) {
  const config = hostConfig(host);
  const { label } = config;
  let executable, prefix;
  try { [executable, ...prefix] = await pluginExecutable(config); }
  catch { throw new Error(`找不到可运行的 ${label} CLI。请安装或更新。`); }

  let stdout;
  try {
    ({ stdout } = await exec(executable, [...prefix, "plugin", ...args, "--json"], {
      encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    }));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`找不到 ${label} CLI。请先安装。`);
    throw new Error(`${label} 插件操作失败：${error.stderr?.trim() || error.stdout?.trim() || error.message}`);
  }
  try { return JSON.parse(stdout); }
  catch {
    if (host === "claude-code") {
      try { return JSON.parse(stdout.trim().split(/\r?\n/).at(-1)); }
      catch { /* Report an invalid response below. */ }
    }
    throw new Error(`${label} 未返回有效的插件结果。请核对 CLI 版本和插件状态。`);
  }
}

function readPackage(directory, host) {
  const { label, manifests } = hostConfig(host);
  for (const path of manifests) {
    const file = join(directory, path);
    if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    const { name, version } = JSON.parse(readFileSync(file, "utf8"));
    if (typeof name === "string" && idPart.test(name)) return { name, version };
    throw new Error(`本地 ${label} 插件清单缺少有效名称：${file}`);
  }
  throw new Error(`找不到本地 ${label} 插件清单：${directory}`);
}

function isInside(directory, target) {
  const path = relative(directory, target);
  return path && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

function readMarketplace(directory, host, catalog) {
  const file = join(directory, catalog);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (typeof manifest?.name !== "string" || !idPart.test(manifest.name) || !Array.isArray(manifest.plugins)) {
    throw new Error(`插件来源清单无效：${file}`);
  }
  const names = new Set();
  const plugins = [];
  for (const entry of manifest.plugins) {
    if (typeof entry?.name !== "string" || !idPart.test(entry.name)) continue;
    if (names.has(entry.name)) throw new Error(`插件来源包含重复名称：${entry.name}`);
    names.add(entry.name);
    const path = catalog.startsWith(".claude-plugin/")
      ? (typeof entry.source === "string" ? entry.source : null)
      : (entry.source?.source === "local" ? entry.source.path : null);
    if (typeof path !== "string" || !path.startsWith("./") || isAbsolute(path)
      || entry.policy?.installation === "NOT_AVAILABLE") continue;
    const packageDir = resolve(directory, path);
    if (!isInside(directory, packageDir) || !existsSync(packageDir)) continue;
    const canonical = realpathSync(packageDir);
    if (!isInside(directory, canonical)) continue;
    const plugin = readPackage(canonical, host);
    if (plugin.name !== entry.name) throw new Error(`插件名称与来源清单不一致：${entry.name}`);
    plugins.push(plugin);
  }
  return { directory, name: manifest.name, plugins };
}

function managedSource(host) {
  const source = readMarketplace(realpathSync(managedBundle), host, hostConfig(host).catalogs[0]);
  if (source.name !== managedName) throw new Error("Helper 的受管插件来源清单无效。");
  return source;
}

export function listManagedPlugins(host = "codex") {
  return managedSource(host).plugins;
}

export function readLocalPluginSource(sourceDir, host = "codex") {
  const { catalogs } = hostConfig(host);
  let directory;
  try { directory = realpathSync(resolve(sourceDir)); }
  catch { throw new Error(`找不到本地插件目录：${sourceDir}`); }
  if (!lstatSync(directory).isDirectory()) throw new Error(`请选择本地插件目录：${directory}`);
  const catalog = catalogs.find(file => existsSync(join(directory, file)));
  if (catalog) {
    const source = readMarketplace(directory, host, catalog);
    if (source.name === managedName) throw new Error(`本地来源使用了 Helper 的受管来源名称 ${managedName}。`);
    return source;
  }
  const plugin = readPackage(directory, host);
  const key = createHash("sha256").update(directory).digest("hex").slice(0, 16);
  return { directory, name: `luminae-local-${key}`, plugins: [plugin], standalone: true };
}

function copyPackage(source, destination) {
  cpSync(source, destination, { recursive: true, filter: path => !lstatSync(path).isSymbolicLink() });
}

function publishSource(source, destination, host) {
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  const marker = join(destination, sourceMarker);
  if (existing && (!existing.isDirectory() || !lstatSync(marker, { throwIfNoEntry: false })?.isFile()
    || readFileSync(marker, "utf8") !== source.name)) {
    throw new Error(`目标来源目录已存在且不属于 Luminae Helper：${destination}`);
  }
  const staging = mkdtempSync(join(dirname(destination), "stage-"));
  const prepared = join(staging, "source");
  const previous = join(staging, "previous");
  let preserveBackup = false;
  try {
    if (source.standalone) {
      const plugin = source.plugins[0];
      const packagePath = `plugins/${plugin.name}`;
      mkdirSync(join(prepared, "plugins"), { recursive: true });
      copyPackage(source.directory, join(prepared, packagePath));
      const file = join(prepared, hostConfig(host).catalogs[0]);
      mkdirSync(dirname(file), { recursive: true });
      const entry = { name: plugin.name, source: `./${packagePath}` };
      const manifest = host === "claude-code"
        ? { name: source.name, owner: { name: "Luminae Helper" }, plugins: [entry] }
        : { name: source.name, plugins: [{ ...entry, source: { source: "local", path: entry.source } }] };
      writeFileSync(file, JSON.stringify(manifest));
    } else {
      copyPackage(source.directory, prepared);
    }
    writeFileSync(join(prepared, sourceMarker), source.name);
    if (existing) renameSync(destination, previous);
    try { renameSync(prepared, destination); }
    catch (error) {
      if (existing) {
        try { renameSync(previous, destination); }
        catch { preserveBackup = true; throw new Error(`旧插件来源已保留于 ${previous}`); }
      }
      throw error;
    }
  } finally {
    if (!preserveBackup) rmSync(staging, { recursive: true, force: true });
  }
}

function sameDirectory(path, directory) {
  return typeof path === "string" && existsSync(path) && realpathSync(path) === realpathSync(directory);
}

async function claudeMarketplace(source) {
  const markets = await nativeJson("claude-code", ["marketplace", "list"]);
  if (!Array.isArray(markets)) throw new Error("Claude Code 未返回来源列表。");
  const existing = markets.find(market => market.name === source.name);
  if (existing && (existing.source !== "directory" || !sameDirectory(existing.path, source.directory))) {
    throw new Error(`Claude Code 的来源 ${source.name} 已指向其他位置。`);
  }
  return existing;
}

async function installFromSource(name, source, host) {
  const config = hostConfig(host);
  const selector = `${name}@${source.name}`;
  const scope = host === "claude-code" ? ["--scope", "user"] : [];
  if (host === "claude-code") {
    if (!await claudeMarketplace(source)) {
      const added = await nativeJson(host, ["marketplace", "add", source.directory, ...scope]);
      if (added?.outcome !== "ok" || added.marketplace !== source.name || !await claudeMarketplace(source)) {
        throw new Error(`Claude Code 未确认来源 ${source.name} 对应 ${source.directory}。`);
      }
    }
  } else {
    const added = await nativeJson(host, ["marketplace", "add", source.directory]);
    if (added?.marketplaceName !== source.name || !sameDirectory(added.installedRoot, source.directory)) {
      throw new Error(`Codex 未确认来源 ${source.name} 对应 ${source.directory}。`);
    }
  }
  try {
    const installed = await nativeJson(host, [config.install, selector, ...scope]);
    if (installed?.pluginId !== selector || (host === "claude-code" && installed.outcome !== "ok")) {
      throw new Error(`${config.label} 未确认安装 ${name}。请检查插件状态。`);
    }
    const version = source.plugins.find(plugin => plugin.name === name)?.version;
    return { pluginId: selector, version: installed.version ?? installed.availableVersion ?? version };
  } catch (error) {
    throw new Error(`来源 ${source.name} 已注册。${error.message}`);
  }
}

export async function installPlugin(name, sourceDir, host = "codex") {
  hostConfig(host);
  if (typeof name !== "string" || !idPart.test(name)) throw new Error("请只指定插件名，无需附加来源名。");
  const managed = sourceDir === undefined;
  const source = managed ? managedSource(host) : readLocalPluginSource(sourceDir, host);
  if (!source.plugins.some(plugin => plugin.name === name)) {
    if (!managed) throw new Error(`本地来源 ${source.directory} 没有可安装的 ${name}。`);
    throw new Error(`${name} 不在 Helper 的受管清单。可安装：${source.plugins.map(plugin => plugin.name).join("、")}。本地包可使用 --source。`);
  }
  if (!managed && !source.standalone) return installFromSource(name, source, host);

  // Codex remembers the marketplace path, including after an npx cache or checkout moves.
  const storage = join(homedir(), ".local", "share", "luminae-helper", `${host}-marketplaces`);
  return withCacheLock(storage, async () => {
    const directory = join(storage, source.name);
    publishSource(source, directory, host);
    return installFromSource(name, { ...source, directory }, host);
  });
}

export function printPluginResult({ pluginId, version }, host) {
  const { label } = hostConfig(host);
  console.log(`  已安装 ${label} 插件 ${pluginId}${version ? ` · ${version}` : ""}`);
  console.log(host === "codex"
    ? "  如插件包含 Hook，请在 Codex 的 Settings → Hooks 或 /hooks 中审阅并信任。"
    : "  在新会话或 /reload-plugins 后加载插件，可用 /hooks 查看 Hook。");
}

export async function runPluginCommand(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
    return;
  }
  const [action, name, ...flags] = args;
  if (action !== "install" || !name || flags.length % 2) throw new Error(usage);
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];
    if (!["--tool", "--source"].includes(flag) || flag in options || !value || value.startsWith("--")) {
      throw new Error(usage);
    }
    options[flag] = value;
  }
  const host = options["--tool"] ?? "codex";
  printPluginResult(await installPlugin(name, options["--source"], host), host);
}
