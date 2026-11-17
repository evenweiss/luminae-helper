import chalk from "chalk";
import gradientString from "gradient-string";
import { select as Select, input, Separator } from "@inquirer/prompts";
import wcswidth from "wcwidth";
import checkboxWithActionRows from "./checkbox-with-action-rows.js";
import { SKILLS, TOOLS, detectInstalledTools, setSkillsSource, useInstalledSkills } from "./constants.js";
import { refreshPublicSource, acquireCachedSource } from "./public-source.js";
import { installSkillToTool, uninstallSkillFromTool } from "./installer.js";
import { PLUGIN_HOSTS, listManagedPlugins, readLocalPluginSource, installPlugin, printPluginResult } from "./codex-plugin.js";

/**
 * 终端主内容区左侧统一的两空格缩进（与顶栏、收尾、错误提示对齐）。
 * 所有面向用户的 `console.log` / 区块标题应以此开头，避免有的顶格、有的多空格。
 */
export const TERM_GUTTER = "  ";

/**
 * 传给所有 @inquirer prompt 的 context。
 * `clearPromptOnDone: true` 会在 prompt 结束时用 ANSI 擦除整块 TUI 占用的行，
 * 避免默认「只换行」导致旧菜单残留在终端上，与下一屏叠在一起（尤其快速按方向键时）。
 * @type {{ clearPromptOnDone: boolean }}
 */
const inquirerContext = { clearPromptOnDone: true };

/**
 * 在关闭一个 inquirer prompt 之后、再 `printBanner` 或打开下一个 prompt 之前调用。
 * 使用 `setImmediate` 推迟到当前轮询阶段之后，让 readline 的 `close`、MuteStream 的 flush
 * 以及 stdin 里积压的字节先落稳（与 Inquirer.js #1303 讨论的背景一致），降低两屏叠画的概率。
 * @returns {Promise<void>}
 */
function afterPromptFlush() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * 打印步骤区块标题（青粗体 + 统一左侧 gutter + 段后空行）。
 * @param {string} title 标题全文，例如「━━━ 选择 Skill ━━━」
 */
function printSectionTitle(title) {
  console.log(chalk.cyan.bold(TERM_GUTTER + title + "\n"));
}

let publicSourceLabel = "";

function printBanner() {
  console.clear();
  const banner = gradientString(["#4facfe", "#a855f7", "#f472b6"])("  LUMINAE HELPER  ");
  console.log("\n" + TERM_GUTTER + banner);
  console.log(chalk.gray(TERM_GUTTER + "AI coding tools' skills manager\n"));
  if (publicSourceLabel) console.log(TERM_GUTTER + publicSourceLabel + "\n");
}

/**
 * Pad a choice label to a consistent display width so icons don't misalign.
 */
export function padChoice(text, targetWidth = 20) {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  const w = wcswidth(stripped);
  const pad = w < 0 ? 0 : Math.max(0, targetWidth - w);
  return text + " ".repeat(pad);
}

/**
 * 解析带功能行的多选结果：`__back__` / `__exit__` 来自「焦点在该行时按回车」的即时提交；
 * 普通 Skill/工具 id 来自多选勾选后回车。若数组中同时含功能值与普通 id，优先按功能处理。
 *
 * @param {unknown} ans
 * @returns {"back"|"exit"|string[]}
 */
export function parseCheckboxResult(ans) {
  if (ans === "exit" || ans === "__exit__") return "exit";
  if (ans === "back" || ans === "__back__") return "back";
  if (ans === "esc_timeout") return "back";
  if (Array.isArray(ans)) {
    if (ans.includes("__exit__")) return "exit";
    if (ans.includes("__back__")) return "back";
    return ans.filter((x) => x !== "__back__" && x !== "__exit__");
  }
  return "back";
}

function installModeDescription(target) {
  return target.installMode === "file" ? "旧命令文件" : "Skill 目录";
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

function displayWidth(text) {
  const width = wcswidth(stripAnsi(text));
  return width < 0 ? stripAnsi(text).length : width;
}

function padCell(text, width) {
  const value = String(text);
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}

function printResultTable(title, rows) {
  if (rows.length === 0) return;

  const headers = ["工具", "内容", "状态", "安装方式"];
  const data = rows.map(row => [row.toolName, row.skillName, row.status, row.mode]);
  const widths = headers.map((header, idx) => Math.max(displayWidth(header), ...data.map(row => displayWidth(row[idx]))));
  const gap = "  ";
  const formatRow = (cells) => TERM_GUTTER + cells.map((cell, idx) => padCell(cell, widths[idx])).join(gap);

  console.log(chalk.cyan.bold(TERM_GUTTER + title));
  console.log(formatRow(headers.map(header => chalk.gray(header))));
  console.log(TERM_GUTTER + widths.map(width => chalk.gray("─".repeat(width))).join(gap));
  for (const row of rows) {
    console.log(formatRow([row.toolName, row.skillName, row.status, row.mode]));
  }
  console.log();
}

function mergeResultRows(...rowGroups) {
  const merged = new Map();
  for (const rows of rowGroups) {
    for (const row of rows) merged.set(row.key, row);
  }
  return [...merged.values()];
}

/**
 * 在列表末尾追加「返回 / 退出」两项（`value` 为 `__back__` / `__exit__`）。
 * 由 `checkbox-with-action-rows` 渲染为功能行：方向键移上去后按回车即触发，空格不会勾选。
 *
 * @param {{ name: string, value: string }[]} items
 * @param {string} backLabel
 */
function withNavChoices(items, backLabel, exitLabel = "✕ 退出") {
  return [
    ...items,
    new Separator(),
    { name: chalk.yellow(backLabel), value: "__back__" },
    ...(exitLabel ? [{ name: exitLabel, value: "__exit__" }] : []),
  ];
}

/**
 * 运行带功能行的多选 Checkbox（见 `checkbox-with-action-rows.js`）。
 * Ctrl+C 时按项目惯例视为退出整段交互。
 *
 * @param {{ message: string, choices: unknown[], loop?: boolean, theme?: object }} config
 * @returns {Promise<string[]>}
 */
async function runCheckbox(config) {
  return checkboxWithActionRows(config, inquirerContext).catch((err) => {
    if (err?.name === "ExitPromptError") return ["__exit__"];
    return ["__exit__"];
  });
}

// ── Step 1: Select entries (checkbox multi-select) ──
async function stepSelectSkills() {
  while (true) {
    await afterPromptFlush();
    printBanner();
    printSectionTitle("━━━ 选择 Skill ━━━");

    const skillChoices = SKILLS.map(s => ({
      name: s.name + (s.legacyCommand ? "（旧命令）" : "") + "  -  " + s.description,
      value: s.id,
      checked: true,
    }));

    const theme = {
      prefix: chalk.cyan(" ◆"),
      style: { highlight: (t) => chalk.cyan(t) },
    };

    const ans = await runCheckbox({
      message: "选择 Skill:",
      choices: withNavChoices(skillChoices, "↩ 返回主菜单", "✕ 退出"),
      loop: false,
      theme,
    });

    const result = parseCheckboxResult(ans);

    if (result === "back") return "back";
    if (result === "exit") return "abort";

    if (result.length === 0) {
      console.log(chalk.yellow(TERM_GUTTER + "请至少选择一个 Skill"));
      await new Promise(r => setTimeout(r, 1200));
      continue;
    }

    return result;
  }
}

// ── Step 2: Select tools (checkbox multi-select) ──
async function stepSelectTools(installedTools) {
  while (true) {
    await afterPromptFlush();
    printBanner();
    printSectionTitle("━━━ 选择目标工具 ━━━");

    const toolChoices = installedTools.map(t => ({
      name: t.name,
      value: t.id,
    }));

    const theme = {
      prefix: chalk.cyan(" ◆"),
      style: { highlight: (t) => chalk.cyan(t) },
    };

    // 第二步：底部为返回/退出功能行（移上后回车触发）
    const ans = await runCheckbox({
      message: "选择工具:",
      choices: withNavChoices(toolChoices, "↩ 返回上一步", "✕ 退出"),
      loop: false,
      theme,
    });

    const result = parseCheckboxResult(ans);

    if (result === "back") return "back";
    if (result === "exit") return "abort";

    if (result.length === 0) {
      console.log(chalk.yellow(TERM_GUTTER + "请至少选择一个工具"));
      await new Promise(r => setTimeout(r, 1200));
      continue;
    }

    return result;
  }
}

/**
 * 将步骤间传递的 id 列表规范为 string[]，避免竞态/异常路径传入非数组导致 .map 报错。
 * @param {unknown} v
 * @returns {string[]}
 */
function asIdArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string");
}

// ── Step 3: Preview + Confirm（仅标题 + 确认菜单；不再展示 Skill/工具明细）──
async function stepPreviewConfirm(isUninstall, embedded = false) {
  await afterPromptFlush();
  printBanner();
  const actionLabel = isUninstall ? "卸载" : "安装";
  printSectionTitle("━━━ " + actionLabel + "预览 ━━━");
  // 第三步：标题下方不再打印 Skill/工具明细列表，由确认菜单直接操作

  const ans = await Select(
    {
      message: "确认" + actionLabel + "？",
      choices: [
        { name: "✓ 确认" + actionLabel, value: "confirm" },
        { name: "↩ 返回上一步", value: "back" },
        ...(embedded ? [{ name: "↩ 返回主菜单", value: "menu" }] : []),
        { name: "✕ 退出", value: "exit" },
      ],
      theme: { prefix: chalk.cyan(" ◆"), style: { highlight: (t) => chalk.cyan(t) } },
    },
    inquirerContext
  ).catch(() => "back");

  if (ans === "menu") return "exit"; // 结束本次操作，回包装器主菜单
  if (ans === "exit") return "abort"; // 退出整个工具
  return ans;
}

// ── Step 4: Execute ──
/**
 * @param {string[]} skillIds
 * @param {string[]} toolIds
 * @param {boolean} isUninstall
 * @param {Set<string>|null} failedKeys - 若提供，只执行 key 在此集合中的组合；否则执行全部
 *   key 格式: `${toolId}::${skillId}`
 * @returns {{ allSuccess: boolean, failedKeys: Set<string>, permanentFailedKeys: Set<string>, resultRows: object[] }}
 */
async function stepExecute(skillIds, toolIds, isUninstall, failedKeys = null) {
  const sids = asIdArray(skillIds);
  const tids = asIdArray(toolIds);
  await afterPromptFlush();
  printBanner();
  console.log();
  printSectionTitle("━━━ 执行中 ━━━");

  let allSuccess = true;
  /** 可重试的失败（I/O 错误等） */
  const retryableFailedKeys = new Set();
  /** 不可重试的失败（不支持、未注册等） */
  const permanentFailedKeys = new Set();
  /** 本轮执行结果，用于最终表格展示 */
  const resultRows = [];
  const total = tids.length * sids.length;
  let current = 0;

  for (const toolId of tids) {
    const tool = TOOLS.find(t => t.id === toolId);
    if (!tool) {
      console.log(chalk.gray(TERM_GUTTER + "- 工具 " + toolId + " 未识别，跳过"));
      continue;
    }

    for (const skillId of sids) {
      current += 1;
      const skill = SKILLS.find(s => s.id === skillId);
      if (!skill) {
        console.log(chalk.gray(TERM_GUTTER + "- Skill " + skillId + " 未识别，跳过"));
        continue;
      }

      const key = `${toolId}::${skillId}`;
      // 如果是重试模式，只执行之前失败的组合
      if (failedKeys && !failedKeys.has(key)) continue;

      console.log(chalk.gray(TERM_GUTTER + `正在${isUninstall ? "卸载" : "安装"} ${current}/${total}：${skill.name} → ${tool.name}`));

      const target = skill.installTargets?.find(tgt => tgt.toolId === toolId);
      if (!target) {
        resultRows.push({
          key,
          toolName: tool.name,
          skillName: skill.name,
          status: chalk.yellow("不支持"),
          mode: "不适用",
        });
        allSuccess = false;
        permanentFailedKeys.add(key);
        continue;
      }

      if (isUninstall) {
        const result = uninstallSkillFromTool(skill, tool);
        if (result.success) {
          resultRows.push({
            key,
            toolName: tool.name,
            skillName: skill.name,
            status: chalk.green("已卸载"),
            mode: installModeDescription(target),
          });
        } else {
          resultRows.push({
            key,
            toolName: tool.name,
            skillName: skill.name,
            status: chalk.yellow("未卸载"),
            mode: result.message,
          });
          allSuccess = false;
          // "未安装" 不可重试，"非本工具安装" 也不可重试
          permanentFailedKeys.add(key);
        }
      } else {
        const result = installSkillToTool(skill, tool);
        if (result.success) {
          resultRows.push({
            key,
            toolName: tool.name,
            skillName: skill.name,
            status: chalk.green("已安装"),
            mode: installModeDescription(target),
          });
        } else if (result.skipped) {
          resultRows.push({
            key,
            toolName: tool.name,
            skillName: skill.name,
            status: chalk.yellow("已跳过"),
            mode: result.message,
          });
          allSuccess = false;
          // 目标被非本工具内容占用，重试也不会变
          permanentFailedKeys.add(key);
        } else {
          resultRows.push({
            key,
            toolName: tool.name,
            skillName: skill.name,
            status: chalk.red("失败"),
            mode: result.message,
          });
          allSuccess = false;
          // 安装失败可能是临时 I/O 问题，可重试
          retryableFailedKeys.add(key);
        }
      }
    }
  }

  console.log();
  if (allSuccess) {
    console.log(chalk.green(TERM_GUTTER + "✅ 操作完成！\n"));
  } else {
    const parts = [];
    if (retryableFailedKeys.size > 0) parts.push(`${retryableFailedKeys.size} 项可重试`);
    if (permanentFailedKeys.size > 0) parts.push(`${permanentFailedKeys.size} 项不可重试`);
    console.log(chalk.yellow(TERM_GUTTER + `⚠ 部分操作失败（${parts.join("，")}），请检查错误信息。\n`));
  }

  return { allSuccess, failedKeys: retryableFailedKeys, permanentFailedKeys, resultRows };
}

// ── Unified flow (install / uninstall) ──
async function runFlow(isUninstall, embedded = false) {
  let heldSource;
  try { return await runFlowWithSource(isUninstall, source => { heldSource = source; }, embedded); }
  finally { await heldSource?.release?.(); }
}

async function runFlowWithSource(isUninstall, holdSource, embedded) {
  const installedTools = detectInstalledTools().filter(t => t.installed);
  if (installedTools.length === 0) {
    await afterPromptFlush();
    printBanner();
    console.log(chalk.yellow(TERM_GUTTER + "⚠ 未检测到任何已安装的 AI 工具\n"));
    console.log(chalk.gray(TERM_GUTTER + "请先安装以下工具之一:\n"));
    TOOLS.forEach(t => {
      // 列表相对上一行再缩进一格 gutter，形成层级感
      console.log(TERM_GUTTER + TERM_GUTTER + chalk.cyan(t.name) + ": " + chalk.gray(t.installHint));
    });
    console.log();
    await input(
      {
        message: "按回车返回主菜单...",
        theme: { prefix: chalk.cyan(" ◆"), style: { highlight: (t) => chalk.cyan(t) } },
      },
      inquirerContext
    ).catch(() => {});
    return "back";
  }

  if (isUninstall) {
    useInstalledSkills();
    publicSourceLabel = "已安装的受管内容（离线卸载）";
  } else {
    let source;
    console.log(TERM_GUTTER + "正在检查公共技能正式版本…");
    try {
      source = await refreshPublicSource();
      holdSource(source);
      publicSourceLabel = `公共技能 ${source.tag} · ${source.commit}`;
    } catch (error) {
      console.log(chalk.yellow(TERM_GUTTER + `公共技能更新失败：${error.message}`));
      const cached = await acquireCachedSource();
      if (cached) holdSource(cached);
      if (!cached) {
        console.log(TERM_GUTTER + "没有可用的已验证缓存，本次安装已停止。");
        await input({ message: "按回车返回主菜单…" }, inquirerContext);
        return "back";
      }
      const choice = await Select({
        message: `是否使用旧缓存 ${cached.tag} · ${cached.commit}？`,
        choices: [
          { name: "返回，不安装", value: "back" },
          { name: "使用此缓存安装（未确认是最新版本）", value: "cache" },
        ],
      }, inquirerContext);
      if (choice !== "cache") return "back";
      source = cached;
      publicSourceLabel = `公共技能旧缓存 ${source.tag} · ${source.commit}（未确认最新）`;
    }
    setSkillsSource(source.root);
  }
  if (SKILLS.length === 0) {
    console.log(TERM_GUTTER + "没有可操作的 Skill。");
    await input({ message: "按回车返回主菜单…" }, inquirerContext);
    return "back";
  }

  let step = 1;
  let selectedSkillIds = null;
  let selectedToolIds = null;

  while (true) {
    if (step === 1) {
      const result = await stepSelectSkills();
      if (result === "back") return "back";
      if (result === "abort") return "abort";
      selectedSkillIds = result;
      step = 2;
    } else if (step === 2) {
      const result = await stepSelectTools(installedTools);
      if (result === "back") { step = 1; continue; }
      if (result === "abort") return "abort";
      selectedToolIds = result;
      step = 3;
    } else if (step === 3) {
      const result = await stepPreviewConfirm(isUninstall, embedded);
      if (result === "back") { step = 2; continue; }
      if (result === "abort") return "abort";
      if (result === "exit") return "exit";
      step = 4;
    } else if (step === 4) {
      const { allSuccess, failedKeys, permanentFailedKeys, resultRows } = await stepExecute(selectedSkillIds, selectedToolIds, isUninstall);
      if (allSuccess) {
        printResultTable(isUninstall ? "卸载结果" : "安装结果", resultRows);
        await input(
          {
            message: embedded ? "按回车返回主菜单..." : "按任意键退出...",
            theme: { prefix: chalk.cyan(" ◆"), style: { highlight: (t) => chalk.cyan(t) } },
          },
          inquirerContext
        ).catch(() => {});
        return "exit";
      } else {
        // 卸载操作失败是"未安装"，重试无意义；安装操作失败可重试
        if (!isUninstall && failedKeys.size > 0) {
          let attempt = 1;
          let retrySuccess = false;
          let retryFailedKeys = failedKeys;
          let accumulatedPermanent = new Set(permanentFailedKeys);
          let accumulatedResultRows = [...resultRows];
          while (attempt < 3) {
            console.log(chalk.yellow(TERM_GUTTER + `第 ${attempt} 次重试（${retryFailedKeys.size} 项）...\n`));
            const retryResult = await stepExecute(selectedSkillIds, selectedToolIds, isUninstall, retryFailedKeys);
            retrySuccess = retryResult.allSuccess;
            retryFailedKeys = retryResult.failedKeys;
            accumulatedResultRows = mergeResultRows(accumulatedResultRows, retryResult.resultRows);
            for (const k of retryResult.permanentFailedKeys) accumulatedPermanent.add(k);
            if (retrySuccess) break;
            attempt++;
          }
          if (retrySuccess && accumulatedPermanent.size === 0) {
            printResultTable("安装结果", accumulatedResultRows);
            await input(
              {
                message: embedded ? "按回车返回主菜单..." : "按任意键退出...",
                theme: { prefix: chalk.cyan(" ◆"), style: { highlight: (t) => chalk.cyan(t) } },
              },
              inquirerContext
            ).catch(() => {});
            return "exit";
          } else if (retrySuccess && accumulatedPermanent.size > 0) {
            // 重试成功但仍有不可重试的失败项（如"不支持"）
            printResultTable("安装结果", accumulatedResultRows);
            console.log(chalk.yellow(TERM_GUTTER + `⚠ ${accumulatedPermanent.size} 项不可重试的操作已跳过（不支持或非本工具安装）\n`));
            await input(
              {
                message: "按任意键返回主菜单...",
                theme: { prefix: chalk.cyan(" ◆"), style: { highlight: (t) => chalk.cyan(t) } },
              },
              inquirerContext
            ).catch(() => {});
            return "back";
          }
        } else if (permanentFailedKeys.size > 0 && failedKeys.size === 0) {
          // 全部是 permanent 失败，无重试价值
          printResultTable(isUninstall ? "卸载结果" : "安装结果", resultRows);
          console.log(chalk.yellow(TERM_GUTTER + `⚠ ${permanentFailedKeys.size} 项操作不可执行（不支持或非本工具安装），已跳过\n`));
          await input(
            {
              message: "按任意键返回主菜单...",
              theme: { prefix: chalk.cyan(" ◆"), style: { highlight: (t) => chalk.cyan(t) } },
            },
            inquirerContext
          ).catch(() => {});
          return "back";
        }
        printResultTable(isUninstall ? "卸载结果" : "安装结果", resultRows);
        console.log(chalk.red(TERM_GUTTER + "❌ 操作未能全部成功，请手动检查。\n"));
        await input(
          {
            message: "按任意键返回主菜单...",
            theme: { prefix: chalk.cyan(" ◆"), style: { highlight: (t) => chalk.cyan(t) } },
          },
          inquirerContext
        ).catch(() => {});
        return "back";
      }
    }
  }
}

export async function runOperation(action) {
  if (!["install", "uninstall"].includes(action)) throw new TypeError(`Unknown skill operation: ${action}`);
  await afterPromptFlush();
  const result = await runFlow(action === "uninstall", true);
  await afterPromptFlush();
  return result;
}

async function runInteractivePluginInstall() {
  printSectionTitle("━━━ 选择插件宿主 ━━━");
  const tools = detectInstalledTools().filter(tool => tool.installed && PLUGIN_HOSTS.includes(tool.id));
  if (!tools.length) {
    console.log(chalk.yellow(TERM_GUTTER + "请先安装 Codex 或 Claude Code CLI。"));
    await input({ message: "按回车返回主菜单…" }, inquirerContext).catch(() => {});
    return "back";
  }
  const host = await Select({
    message: "选择插件宿主:",
    choices: withNavChoices(tools.map(tool => ({ name: tool.name, value: tool.id })), "↩ 返回主菜单"),
  }, inquirerContext);
  if (host === "__back__") return "back";
  if (host === "__exit__") return "exit";
  const { name: hostName } = tools.find(tool => tool.id === host);
  const sourceDir = (await input({ message: "本地插件目录（留空使用 Helper 受管插件）:" }, inquirerContext)).trim();
  try {
    const local = sourceDir ? readLocalPluginSource(sourceDir, host) : null;
    const plugins = local ? local.plugins : listManagedPlugins(host);
    if (!plugins.length) throw new Error("当前来源没有可安装的插件。");
    while (true) {
      const selected = await Select({
        message: `选择 ${hostName} 插件:`,
        choices: withNavChoices(plugins.map(plugin => ({
          name: `${plugin.name}${plugin.version ? ` · ${plugin.version}` : ""}`,
          value: plugin.name,
        })), "↩ 返回主菜单"),
      }, inquirerContext);
      if (selected === "__back__") return "back";
      if (selected === "__exit__") return "exit";
      const confirmation = await Select({
        message: `安装 ${selected} 到 ${hostName}${local ? `（本地 ${local.directory}）` : "（Helper 受管）"}？`,
        choices: [
          { name: "返回上一步", value: "back" },
          { name: "确认安装", value: "confirm" },
          { name: "退出", value: "exit" },
        ],
      }, inquirerContext);
      if (confirmation === "back") continue;
      if (confirmation !== "confirm") return "exit";
      printPluginResult(await installPlugin(selected, local?.directory, host), host);
      break;
    }
  } catch (error) {
    if (error?.name === "ExitPromptError") return "exit";
    console.log(chalk.red(TERM_GUTTER + error.message));
  }
  await input({ message: "按回车返回主菜单…" }, inquirerContext).catch(() => {});
  return "back";
}

// ── Main ──
export async function runInteractive() {
  let exit = false;

  while (!exit) {
    printBanner();

    const action = await Select(
      {
        message: "选择操作:",
        choices: [
          { name: padChoice(" 安装 / 更新", 20), value: "install" },
          { name: padChoice(" 卸载 Skill", 20), value: "uninstall" },
          { name: padChoice(" 退出", 20), value: "exit" },
        ],
        theme: { prefix: chalk.cyan(" ◆"), style: { highlight: (t) => chalk.cyan(t) } },
      },
      inquirerContext
    ).catch(() => "exit");

    if (action === "exit") {
      break;
    }

    await afterPromptFlush();
    let result;
    if (action === "install") {
      const kind = await Select({
        message: "选择要安装的内容类型:",
        choices: withNavChoices([
          { name: "Skill", value: "skill" },
          { name: "插件", value: "plugin" },
        ], "↩ 返回主菜单"),
      }, inquirerContext);
      if (kind === "__back__") continue;
      if (kind === "__exit__") break;
      await afterPromptFlush();
      result = kind === "plugin" ? await runInteractivePluginInstall() : await runFlow(false);
    } else {
      result = await runFlow(true);
    }

    if (result === "exit" || result === "abort") {
      exit = true;
    }
    await afterPromptFlush();
    // "back" or "done" → loop continues, show main menu again
  }

  console.log(chalk.gray("\n" + TERM_GUTTER + "👋 Bye!\n"));
  return;
}
