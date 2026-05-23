import { readFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";

export const TERM_GUTTER = "  ";

/**
 * 读取当前包的 package.json。
 * import.meta.dirname = <package>/src/utils
 * package.json 在 <package>/，需要上跳两级
 */
function readPackageJson() {
  const packageRoot = globalThis.__LUMINAE_PACKAGE_ROOT__ || join(import.meta.dirname, "..", "..");
  const pkgPath = join(packageRoot, "package.json");
  return JSON.parse(readFileSync(pkgPath, "utf-8"));
}

/**
 * 获取当前包名。
 */
export function getPackageName() {
  return readPackageJson().name;
}

/**
 * 获取当前版本号。
 */
export function getVersion() {
  return readPackageJson().version;
}

/**
 * 获取当前包的 registry URL。
 * 优先读 publishConfig.registry，否则用 npm 默认 registry。
 */
function getRegistry() {
  const pkg = readPackageJson();
  return pkg.publishConfig?.registry || "https://registry.npmjs.org/";
}

/**
 * 从 registry 查询指定包的最新版本。
 * @param {string} packageName
 * @param {string} registry
 * @returns {Promise<string|null>} 最新版本号，查询失败返回 null
 */
async function fetchLatestVersion(packageName, registry) {
  const url = `${registry}${packageName}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // npmjs 返回 data["dist-tags"].latest，私有 registry 格式类似
    return data?.["dist-tags"]?.latest ?? data?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * 比较两个 semver 版本号（简单比较，仅支持 x.y.z 格式）。
 * @returns {number} 正数=a>b, 0=相等, 负数=a<b
 */
function compareSemver(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * 打印当前版本号。
 */
export function printVersion() {
  const pkg = readPackageJson();
  console.log(`${pkg.name}@${pkg.version}`);
}

/**
 * 检查是否有新版本并输出提示。
 */
export async function checkOutdated() {
  const pkg = readPackageJson();
  const currentVersion = pkg.version;
  const packageName = pkg.name;
  const registry = getRegistry();

  console.log(TERM_GUTTER + `当前版本: ${packageName}@${currentVersion}`);
  console.log(TERM_GUTTER + `检查更新中...`);

  const latestVersion = await fetchLatestVersion(packageName, registry);

  if (!latestVersion) {
    console.log(chalk.yellow(TERM_GUTTER + "⚠ 无法获取最新版本信息，请检查网络连接"));
    return;
  }

  if (compareSemver(currentVersion, latestVersion) >= 0) {
    console.log(chalk.green(TERM_GUTTER + `✓ 已是最新版本 (${currentVersion})`));
  } else {
    console.log(chalk.yellow(TERM_GUTTER + `⚠ 发现新版本: ${latestVersion}（当前: ${currentVersion})`));
    console.log(TERM_GUTTER + `  更新命令: npm install -g ${packageName}`);
  }
}
