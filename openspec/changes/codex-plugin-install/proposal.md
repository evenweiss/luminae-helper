## Why

用户可用 Luminae Helper 安装独立技能，但含 Hook 的插件需要由 Codex 或 Claude Code 管理。将插件安装放进现有安装入口，并提供等价命令，方便交互和脚本使用。

## What Changes

- 独立 CLI 的「安装 / 更新」可选择Skill 或插件。插件可从 Helper 受管清单或显式指定的本地包选择。
- 增加 `plugin install <技能名> [--tool codex|claude-code] [--source <本地包目录>]`。交互与命令调用相同安装逻辑，由目标宿主安装插件和加载 Hook。
- 原公共技能、卸载、包装器操作和版本命令继续按原契约执行。
