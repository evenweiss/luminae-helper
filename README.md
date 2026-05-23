# luminae-helper

Install public AI agent commands/skills into local AI coding tools.

The package bundles a build-time snapshot from `evenweiss/ai-agent-skills`; runtime installation is local-only and does not fetch GitHub.

## Install

```bash
npm install -g luminae-helper --registry https://registry.npmjs.org/
```

## Use

```bash
luminae-helper
luminae-helper --version
luminae-helper outdated
```

## Supported tools

| Tool | command source | skill source |
|---|---|---|
| Claude Code | `~/.claude/commands/` | `~/.claude/skills/` |
| Codex | — | `~/.codex/skills/` |
| Cursor | — | `~/.cursor/skills/` |
| Hermes Agent | — | `~/.hermes/skills/` |
| OpenCode | — | `~/.opencode/skills/` |
| Trae | `~/.trae/commands/` | — |

## Build-time skill source

For local development, keep `ai-agent-skills` as a sibling directory or set:

```bash
LUMINAE_SKILLS_SOURCE=/path/to/ai-agent-skills npm run sync-skills
```

Publishing runs `scripts/fetch-skills.js --strict` and bundles `commands/` / `skills/` into the tarball.

## Library API

```js
import { runCli } from "luminae-helper";

await runCli({ argv: process.argv.slice(2), packageRoot: import.meta.dirname });
```

`packageRoot` lets wrapper packages provide their own bundled `commands/` and `skills/` while reusing the CLI engine.
