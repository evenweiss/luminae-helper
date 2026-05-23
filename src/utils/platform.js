import { spawnSync } from "child_process";
import { platform } from "os";

export function commandExists(commandName) {
  try {
    const lookup = getCommandLookup(platform(), commandName);
    const result = spawnSync(lookup.command, lookup.args, {
      encoding: "utf-8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error) return false;
    return result.status === 0;
  } catch {
    return false;
  }
}

export function runCommand(command, args = [], options = {}) {
  const { encoding = "utf-8", inherit = false } = options;
  const result = spawnSync(command, args, {
    encoding,
    shell: platform() === "win32",
    stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

function getCommandLookup(plat, commandName) {
  if (plat === "win32") return { command: "where", args: [commandName] };
  return { command: "which", args: [commandName] };
}
