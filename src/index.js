const usage = `用法：luminae-helper [命令]

  （无命令）                    交互式安装 / 更新 / 卸载
  list                          查看已安装的技能与插件
  outdated                      检查工具与技能仓库更新
  skill install <技能ID...|--all> --tool <宿主ID>
  skill uninstall <技能ID...|--all> --tool <宿主ID>
  skill --help
  plugin install|uninstall <插件名> --tool <插件宿主>
  plugin --help
  --version, -v
  --help, -h`;

export async function runCli(argv = process.argv.slice(2)) {
  if (["--help", "-h"].includes(argv[0])) {
    console.log(usage);
    return 0;
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

  if (argv[0] === "list") {
    const { printInstalledContent } = await import("./lib/ui.js");
    printInstalledContent();
    return 0;
  }

  if (argv.length) {
    console.error(`  未知命令：${argv[0]}\n`);
    console.error(usage);
    return 1;
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
