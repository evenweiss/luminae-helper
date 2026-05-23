#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = await runCli({ argv: process.argv.slice(2), packageRoot });
process.exit(code);
