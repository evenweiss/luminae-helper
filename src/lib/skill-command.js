import { discoverSkills, TOOLS } from "./constants.js";
import { installSkillToTool } from "./installer.js";
import { refreshPublicSource } from "./public-source.js";
import { commandExists } from "../utils/platform.js";

const usage = "用法：luminae-helper skill install <技能ID> --tool <宿主ID>";
const toolIds = TOOLS.map(tool => tool.id).join("、");

export async function runSkillCommand(args) {
  const help = ["--help", "-h"];
  if ((args.length === 1 && help.includes(args[0]))
    || (args.length === 2 && args[0] === "install" && help.includes(args[1]))) {
    console.log(`${usage}\n可用宿主：${toolIds}`);
    return;
  }

  const [action, skillId, flag, toolId] = args;
  if (args.length !== 4 || action !== "install" || !skillId || skillId.startsWith("-") || flag !== "--tool" || !toolId) {
    throw new Error(usage);
  }
  const tool = TOOLS.find(tool => tool.id === toolId);
  if (!tool) throw new Error(`不支持宿主 ${toolId}。可用宿主：${toolIds}`);
  if (!commandExists(tool.command)) throw new Error(`未检测到 ${tool.name}。请先安装：${tool.installHint}`);

  const source = await refreshPublicSource();
  try {
    const catalog = discoverSkills(source.root);
    const skill = catalog.find(skill => skill.id === skillId);
    if (!skill) {
      const ids = catalog.map(skill => skill.id).sort().join("、");
      throw new Error(`公共技能 ${source.tag} 中没有 ${skillId}。可安装：${ids}`);
    }
    const result = installSkillToTool(skill, tool);
    if (!result.success) throw new Error(result.message);
    console.log(`  已安装 ${skill.id} 到 ${tool.name}（公共技能 ${source.tag} · ${source.commit}）`);
    console.log(`  ${result.message}`);
  } finally {
    await source.release?.();
  }
}
