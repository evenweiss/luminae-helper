# Changelog

## 0.0.12

- Split the public CLI engine into its own `luminae-helper` repository.
- Load public command/skill content from `evenweiss/ai-agent-skills` at build time.
- Export `runCli()` so wrapper packages can reuse the CLI engine with their own bundled content.
