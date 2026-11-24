import { discoverInstalledSkills, TOOLS } from "./constants.js";
import { PLUGIN_HOSTS, listInstalledPlugins } from "./codex-plugin.js";
import { readCachedSource } from "./public-source.js";

function toolName(id) {
  return TOOLS.find(tool => tool.id === id)?.name ?? id;
}

// 只读本地状态：技能看宿主目录里的受管标记，插件看宿主自己的登记。
export function collectInstalled() {
  const rows = [];
  const seen = new Set();
  for (const skill of discoverInstalledSkills()) {
    const id = skill.id.replace(/^(dir|file):/, "");
    for (const target of skill.installTargets) {
      const key = `${target.toolId}::${target.installMode}::${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ type: "技能", tool: toolName(target.toolId), name: id, version: "—" });
    }
  }
  for (const host of PLUGIN_HOSTS) {
    for (const plugin of listInstalledPlugins(host)) {
      rows.push({ type: "插件", tool: toolName(host), name: plugin.name, version: plugin.version ?? "—" });
    }
  }
  const typeOrder = { "技能": 0, "插件": 1 };
  rows.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]
    || a.tool.localeCompare(b.tool) || a.name.localeCompare(b.name));
  return { rows, source: readCachedSource() };
}
