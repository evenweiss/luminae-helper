export { isManagedSkill } from "./lib/managed-by.js";
// 包装器（如 kfz-skills-helper）复用带「返回 / 退出」功能行的多选列表
export { default as checkboxWithActionRows, NAV_BACK, NAV_EXIT } from "./lib/checkbox-with-action-rows.js";

export async function runCli(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv.slice(2);
  if (options.packageRoot) {
    globalThis.__LUMINAE_PACKAGE_ROOT__ = options.packageRoot;
  }

  if (argv[0] === "plugin" || argv[0] === "skill") {
    try {
      const runCommand = argv[0] === "plugin"
        ? (await import("./lib/codex-plugin.js")).runPluginCommand
        : (await import("./lib/skill-command.js")).runSkillCommand;
      await runCommand(argv.slice(1));
      return 0;
    } catch (error) {
      console.error("  Error:", error.message);
      return 1;
    }
  }

  const { printVersion, checkOutdated } = await import("./utils/version.js");

  if (argv.includes("--version") || argv.includes("-v")) {
    printVersion();
    return 0;
  }

  if (argv[0] === "outdated") {
    await checkOutdated();
    return 0;
  }

  const { runInteractive, runOperation, TERM_GUTTER } = await import("./lib/ui.js");
  try {
    if (options.operation) {
      // 面板里显式选择「退出」时，把结束整个工具的意图交给包装器
      if (await runOperation(options.operation) === "abort") return "abort";
    } else await runInteractive();
    return 0;
  } catch (error) {
    if (error?.name === "ExitPromptError") {
      if (!options.operation) console.log("\n" + TERM_GUTTER + "👋 Bye!\n");
      return 0;
    }
    console.error("\n" + TERM_GUTTER + "Error:", error.message ?? String(error));
    return 1;
  }
}

/** Execute one shared public-skill flow, then return control to a wrapper. */
export async function runSkillOperation(action, options = {}) {
  if (!["install", "uninstall"].includes(action)) throw new TypeError(`Unknown skill operation: ${action}`);
  return runCli({ ...options, argv: [], operation: action });
}
