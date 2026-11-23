import { execFile } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { withCacheLock } from "./cache-lifecycle.js";
import { refreshPublicSource } from "./public-source.js";

const exec = promisify(execFile);
const hosts = {
  codex: { label: "Codex", command: "codex", catalogs: [".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"], manifests: [".codex-plugin/plugin.json", "plugin.json"], install: "add" },
  "claude-code": { label: "Claude Code", command: "claude", catalogs: [".claude-plugin/marketplace.json"], manifests: [".claude-plugin/plugin.json"], install: "install" },
  // 目录宿主：没有插件 marketplace CLI，安装 = 复制到宿主约定目录并登记
  cursor: { label: "Cursor", command: "cursor", manifests: [".cursor-plugin/plugin.json"], target: () => join(homedir(), ".cursor", "plugins", "local") },
  "hermes-agent": { label: "Hermes Agent", command: "hermes", manifests: ["plugin.yaml"], target: () => join(homedir(), ".hermes", "plugins") },
  pi: { label: "Pi", command: "pi", manifests: ["package.json"], target: () => join(homedir(), ".local", "share", "luminae-helper", "pi-packages") },
};
export const PLUGIN_HOSTS = Object.keys(hosts);
function hostConfig(host) {
  if (!PLUGIN_HOSTS.includes(host)) throw new Error(`不支持插件宿主 ${host}。可用宿主：${PLUGIN_HOSTS.join("、")}`);
  return hosts[host];
}
const idPart = /^[a-z0-9][a-z0-9._-]*$/i;
const usage = `用法：luminae-helper plugin install|uninstall <插件名> [--tool ${PLUGIN_HOSTS.join("|")}] [--source <本地包目录>]`;
const managedName = "luminae-helper";
const sourceMarker = ".luminae-helper-marketplace";
const pluginMarker = ".luminae-helper-plugin";

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
    const content = readFileSync(file, "utf8");
    const data = path.endsWith(".yaml") || path.endsWith(".yml") ? parseYaml(content) : JSON.parse(content);
    if (host === "pi" && !data?.pi) throw new Error(`本地 ${label} 包缺少 pi 配置：${file}`);
    const { name, version } = data ?? {};
    if (typeof name === "string" && idPart.test(name)) return { name, version };
    throw new Error(`本地 ${label} 插件清单缺少有效名称：${file}`);
  }
  throw new Error(`找不到本地 ${label} 插件清单：${directory}`);
}

function scanPlugins(directory, host) {
  const root = join(directory, "plugins");
  if (!lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];
  const plugins = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = join(root, entry.name);
    try { plugins.push({ ...readPackage(dir, host), dir }); } catch { /* 不是该宿主的插件 */ }
  }
  return plugins;
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
    plugins.push({ ...plugin, dir: canonical });
  }
  return { directory, name: manifest.name, plugins };
}

// 受管插件取自技能仓库最新正式 Tag 的运行时快照（与技能共用同一份缓存）。
function snapshotSource(host, root) {
  if (typeof root !== "string" || !existsSync(root)) {
    throw new Error("缺少插件来源快照，请重新运行安装以获取技能仓库的最新版本。");
  }
  const directory = realpathSync(root);
  const config = hostConfig(host);
  if (!config.catalogs) {
    const plugins = scanPlugins(directory, host);
    if (!plugins.length) throw new Error(`正式版本没有可安装的 ${config.label} 插件。`);
    return { directory, name: managedName, plugins, generated: true };
  }
  const catalog = config.catalogs.find(file => existsSync(join(directory, file)));
  if (!catalog) throw new Error(`正式版本没有 ${config.label} 的插件来源清单。`);
  const source = readMarketplace(directory, host, catalog);
  if (!source.plugins.length) throw new Error(`正式版本没有可安装的 ${config.label} 插件。`);
  return { ...source, name: managedName, generated: true };
}

export function listManagedPlugins(host = "codex", root) {
  return snapshotSource(host, root).plugins;
}

export function readLocalPluginSource(sourceDir, host = "codex") {
  const { catalogs = [], manifests } = hostConfig(host);
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
  const key = createHash("sha256").update(directory).digest("hex").slice(0, 16);
  if (manifests.some(path => existsSync(join(directory, path)))) {
    return { directory, name: `luminae-local-${key}`, plugins: [{ ...readPackage(directory, host), dir: directory }], standalone: true };
  }
  const plugins = scanPlugins(directory, host);
  if (!plugins.length) throw new Error(`找不到本地 ${hostConfig(host).label} 插件清单：${directory}`);
  return { directory, name: `luminae-local-${key}`, plugins };
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
    if (source.generated) {
      mkdirSync(join(prepared, "plugins"), { recursive: true });
      for (const plugin of source.plugins) {
        copyPackage(plugin.dir, join(prepared, "plugins", plugin.name));
      }
      const entries = source.plugins.map(plugin => ({ name: plugin.name, source: `./plugins/${plugin.name}` }));
      const manifest = host === "claude-code"
        ? { name: source.name, owner: { name: "Luminae Helper" }, plugins: entries }
        : { name: source.name, plugins: entries.map(entry => ({ ...entry, source: { source: "local", path: entry.source } })) };
      const file = join(prepared, hostConfig(host).catalogs[0]);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    } else if (source.standalone) {
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

async function runNative(host, args) {
  const config = hostConfig(host);
  let executable, prefix;
  try { [executable, ...prefix] = await pluginExecutable(config); }
  catch { throw new Error(`找不到可运行的 ${config.label} CLI。请安装或更新。`); }
  try {
    const { stdout } = await exec(executable, [...prefix, ...args], {
      encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`找不到 ${config.label} CLI。请先安装。`);
    throw new Error(`${config.label} 插件操作失败：${error.stderr?.trim() || error.stdout?.trim() || error.message}`);
  }
}

function publishPlugin(sourceDir, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || !lstatSync(join(destination, pluginMarker), { throwIfNoEntry: false })?.isFile())) {
    throw new Error(`目标插件目录已存在且不属于 Luminae Helper：${destination}`);
  }
  const staging = mkdtempSync(join(dirname(destination), "stage-"));
  const prepared = join(staging, "plugin");
  const previous = join(staging, "previous");
  let preserveBackup = false;
  try {
    copyPackage(sourceDir, prepared);
    writeFileSync(join(prepared, pluginMarker), managedName);
    if (existing) renameSync(destination, previous);
    try { renameSync(prepared, destination); }
    catch (error) {
      if (existing) {
        try { renameSync(previous, destination); }
        catch { preserveBackup = true; throw new Error(`旧插件已保留于 ${previous}`); }
      }
      throw error;
    }
  } finally {
    if (!preserveBackup) rmSync(staging, { recursive: true, force: true });
  }
}

async function enableHermesPlugin(name) {
  await runNative("hermes-agent", ["plugins", "enable", name]);
  const status = await runNative("hermes-agent", ["plugins", "show", name]);
  if (!/Status:\s*enabled/i.test(status)) throw new Error(`Hermes Agent 未确认启用插件 ${name}。`);
}

async function registerPiPackage(directory) {
  await runNative("pi", ["install", directory]);
  const agentDir = join(homedir(), ".pi", "agent");
  const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  const registered = (settings.packages ?? [])
    .map(entry => typeof entry === "string" ? entry : entry?.source)
    .filter(source => typeof source === "string")
    .some(source => resolve(agentDir, source) === directory);
  if (!registered) throw new Error(`Pi 未登记已安装的插件 ${directory}。`);
}

async function installDirectoryPlugin(name, plugin, host) {
  if (!plugin.dir) throw new Error(`插件 ${name} 缺少来源目录。`);
  const destination = join(hostConfig(host).target(), name);
  publishPlugin(plugin.dir, destination);
  if (host === "hermes-agent") await enableHermesPlugin(name);
  if (host === "pi") await registerPiPackage(destination);
  return { pluginId: name, version: plugin.version };
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

export async function installPlugin(name, sourceDir, host = "codex", snapshotRoot) {
  hostConfig(host);
  if (typeof name !== "string" || !idPart.test(name)) throw new Error("请只指定插件名，无需附加来源名。");
  const managed = sourceDir === undefined;
  const source = managed ? snapshotSource(host, snapshotRoot) : readLocalPluginSource(sourceDir, host);
  if (!source.plugins.some(plugin => plugin.name === name)) {
    if (!managed) throw new Error(`本地来源 ${source.directory} 没有可安装的 ${name}。`);
    throw new Error(`${name} 不在 Helper 的受管清单。可安装：${source.plugins.map(plugin => plugin.name).join("、")}。本地包可使用 --source。`);
  }
  if (!managed && !source.standalone) return installFromSource(name, source, host);
  if (hostConfig(host).target) {
    const plugin = source.plugins.find(item => item.name === name);
    return installDirectoryPlugin(name, plugin, host);
  }

  // Codex remembers the marketplace path, including after an npx cache or checkout moves.
  const storage = join(homedir(), ".local", "share", "luminae-helper", `${host}-marketplaces`);
  return withCacheLock(storage, async () => {
    const directory = join(storage, source.name);
    publishSource(source, directory, host);
    return installFromSource(name, { ...source, directory }, host);
  });
}

function hostPluginNames(host) {
  if (host === "codex") {
    const file = join(homedir(), ".codex", "config.toml");
    if (!existsSync(file)) return [];
    return [...readFileSync(file, "utf8").matchAll(/^\[plugins\."([^"@]+)@luminae-helper"\]$/gm)].map(match => match[1]);
  }
  if (host === "claude-code") {
    const file = join(homedir(), ".claude", "plugins", "installed_plugins.json");
    if (!existsSync(file)) return [];
    const suffix = `@${managedName}`;
    return Object.keys(JSON.parse(readFileSync(file, "utf8")).plugins ?? {})
      .filter(key => key.endsWith(suffix)).map(key => key.slice(0, -suffix.length));
  }
  const directory = hostConfig(host).target();
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory()
      && lstatSync(join(directory, entry.name, pluginMarker), { throwIfNoEntry: false })?.isFile())
    .map(entry => entry.name);
}

export function listInstalledPlugins(host = "codex") {
  return hostPluginNames(host).map(name => ({ name }));
}

export async function uninstallPlugin(name, host = "codex") {
  hostConfig(host);
  if (typeof name !== "string" || !idPart.test(name)) throw new Error("请只指定插件名，无需附加来源名。");
  if (!hostPluginNames(host).includes(name)) throw new Error(`${hostConfig(host).label} 没有 Helper 管理的插件 ${name}。`);
  if (host === "codex") {
    await runNative("codex", ["plugin", "remove", `${name}@${managedName}`, "--json"]);
  } else if (host === "claude-code") {
    await runNative("claude-code", ["plugin", "uninstall", `${name}@${managedName}`, "--scope", "user", "--json"]);
  } else if (host === "hermes-agent") {
    await runNative("hermes-agent", ["plugins", "remove", name]);
  } else if (host === "pi") {
    const directory = join(hostConfig("pi").target(), name);
    await runNative("pi", ["remove", directory]);
    rmSync(directory, { recursive: true, force: true });
  } else {
    rmSync(join(hostConfig("cursor").target(), name), { recursive: true, force: true });
  }
  if (hostPluginNames(host).includes(name)) throw new Error(`未能从 ${hostConfig(host).label} 卸载插件 ${name}。`);
  return { pluginId: name, host };
}

const hostNotes = {
  codex: "  如插件包含 Hook，请在 Codex 的 Settings → Hooks 或 /hooks 中审阅并信任。",
  "claude-code": "  在新会话或 /reload-plugins 后加载插件，可用 /hooks 查看 Hook。",
  cursor: "  重启 Cursor 或执行 Developer: Reload Window 后加载；组织策略需允许本地插件导入。",
  "hermes-agent": "  已登记并启用，新会话生效。",
  pi: "  已登记到 Pi，新会话加载扩展和技能。",
};

export function pluginHostNote(host) {
  return hostNotes[host] ?? "";
}

export function printPluginResult({ pluginId, version }, host) {
  const { label } = hostConfig(host);
  console.log(`  已安装 ${label} 插件 ${pluginId}${version ? ` · ${version}` : ""}`);
  console.log(hostNotes[host]);
}

export async function runPluginCommand(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
    return;
  }
  const [action, name, ...flags] = args;
  if (!["install", "uninstall"].includes(action) || !name || flags.length % 2) throw new Error(usage);
  if (!idPart.test(name)) throw new Error("请只指定插件名，无需附加来源名。");
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];
    if (!["--tool", "--source"].includes(flag) || flag in options || !value || value.startsWith("--")) {
      throw new Error(usage);
    }
    options[flag] = value;
  }
  const host = options["--tool"] ?? "codex";
  if (action === "uninstall") {
    if (options["--source"]) throw new Error(usage);
    await uninstallPlugin(name, host);
    console.log(`  已卸载 ${hostConfig(host).label} 插件 ${name}`);
    return;
  }
  if (options["--source"]) {
    printPluginResult(await installPlugin(name, options["--source"], host), host);
    return;
  }
  const snapshot = await refreshPublicSource();
  try {
    printPluginResult(await installPlugin(name, undefined, host, snapshot.root), host);
    console.log(`  插件来源：技能仓库 ${snapshot.tag}（${snapshot.commit.slice(0, 7)}）`);
  } finally {
    await snapshot.release();
  }
}
