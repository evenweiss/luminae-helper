import { discoverInstalledSkills, discoverSkills, TOOLS } from "./constants.js";
import { installSkillToTool, uninstallSkillFromTool } from "./installer.js";
import { refreshPublicSource } from "./public-source.js";
import { commandExists } from "../utils/platform.js";

const usage = `用法：luminae-helper skill install <技能ID...|--all> --tool <宿主ID>
      luminae-helper skill uninstall <技能ID...|--all> --tool <宿主ID>`;
const toolIds = TOOLS.map(tool => tool.id).join("、");

function parse(args) {
  const [action, ...rest] = args;
  const toolIndex = rest.indexOf("--tool");
  if (!["install", "uninstall"].includes(action) || toolIndex < 1 || toolIndex !== rest.length - 2) throw new Error(usage);
  const names = rest.slice(0, toolIndex);
  const toolId = rest[toolIndex + 1];
  if (!toolId || names.some(name => name.startsWith("-") && name !== "--all")) throw new Error(usage);
  const all = names[0] === "--all";
  if (all ? names.length !== 1 : names.length === 0) throw new Error(usage);
  return { action, names, all, toolId };
}

async function install(names, all, tool) {
  const source = await refreshPublicSource();
  try {
    const catalog = discoverSkills(source.root);
    const missing = all ? [] : names.filter(id => !catalog.some(skill => skill.id === id));
    if (missing.length) {
      throw new Error(`技能 ${source.tag} 中没有 ${missing.join("、")}。可安装：${catalog.map(skill => skill.id).sort().join("、")}`);
    }
    const selected = all ? catalog : names.map(id => catalog.find(skill => skill.id === id));
    const failed = [];
    for (const skill of selected) {
      const result = installSkillToTool(skill, tool);
      if (!result.success) {
        failed.push(skill.id);
        console.log(`  ❌ ${skill.id}: ${result.message}`);
        continue;
      }
      console.log(`  已安装 ${skill.id} 到 ${tool.name}（技能 ${source.tag} · ${source.commit}）`);
      console.log(`  ${result.message}`);
    }
    if (failed.length) throw new Error(`${failed.length} 项安装失败：${failed.join("、")}`);
  } finally {
    await source.release?.();
  }
}

function uninstall(names, all, tool) {
  const installed = discoverInstalledSkills([tool]);
  const idOf = entry => entry.id.replace(/^(dir|file):/, "");
  const missing = all ? [] : names.filter(id => !installed.some(entry => idOf(entry) === id));
  if (missing.length) throw new Error(`${tool.name} 没有 Helper 安装的技能 ${missing.join("、")}。`);
  const entries = all ? installed : installed.filter(entry => names.includes(idOf(entry)));
  if (!entries.length) {
    console.log(`  ${tool.name} 没有 Helper 管理的技能。`);
    return;
  }
  const failed = [];
  for (const entry of entries) {
    const name = idOf(entry);
    const result = uninstallSkillFromTool(entry, tool);
    if (!result.success) {
      failed.push(name);
      console.log(`  ❌ ${name}: ${result.message}`);
      continue;
    }
    console.log(`  已从 ${tool.name} 卸载 ${name}`);
  }
  if (failed.length) throw new Error(`${failed.length} 项卸载失败：${failed.join("、")}`);
}

export async function runSkillCommand(args) {
  const help = ["--help", "-h"];
  if (help.includes(args[0]) || (["install", "uninstall"].includes(args[0]) && help.includes(args[1]))) {
    console.log(`${usage}\n可用宿主：${toolIds}\n--all：安装全部技能，或卸载该宿主全部受管技能`);
    return;
  }

  const { action, names, all, toolId } = parse(args);
  const tool = TOOLS.find(tool => tool.id === toolId);
  if (!tool) throw new Error(`不支持宿主 ${toolId}。可用宿主：${toolIds}`);

  if (action === "install") {
    if (!commandExists(tool.command)) throw new Error(`未检测到 ${tool.name}。请先安装：${tool.installHint}`);
    await install(names, all, tool);
  } else {
    uninstall(names, all, tool);
  }
}
