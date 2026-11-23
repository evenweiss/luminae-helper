export async function runCli(argv = process.argv.slice(2)) {
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

  const { runInteractive, TERM_GUTTER } = await import("./lib/ui.js");
  try {
    await runInteractive();
    return 0;
  } catch (error) {
    if (error?.name === "ExitPromptError") {
      console.log("\n" + TERM_GUTTER + "👋 Bye!\n");
      return 0;
    }
    console.error("\n" + TERM_GUTTER + "Error:", error.message ?? String(error));
    return 1;
  }
}
