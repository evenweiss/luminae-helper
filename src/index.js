export async function runCli(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv.slice(2);
  if (options.packageRoot) {
    globalThis.__LUMINAE_PACKAGE_ROOT__ = options.packageRoot;
  }

  const { runInteractive, TERM_GUTTER } = await import("./lib/ui.js");
  const { printVersion, checkOutdated } = await import("./utils/version.js");

  if (argv.includes("--version") || argv.includes("-v")) {
    printVersion();
    return 0;
  }

  if (argv[0] === "outdated") {
    await checkOutdated();
    return 0;
  }

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
