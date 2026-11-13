# luminae-helper

AI 编程工具的 Skill 和插件安装 CLI。一键将公共 AI agent 技能安装到 Claude Code、Cursor、Codex、Hermes Agent 和 OpenCode。

公共 Skill 源码从正式 Tag 获取。选择「安装 / 更新 → Skill」时从 `ai-skills` 拉取最新正式 Git Tag，再复制到目标工具。首次需要网络与 Git；卸载和 `--version` 不需要拉取技能。

## 前置条件

- Node.js >= 18.0.0
- Git（公共技能安装 / 更新需要访问 GitHub）
- 至少一个目标 AI 工具已安装

## 安装

```bash
npm install -g luminae-helper
```

安装后全局可用 `luminae-helper` 命令。

## 使用

### 安装技能

```bash
luminae-helper
```

选择「安装 / 更新 → Skill」，分四步：

1. **选择内容** — 勾选要安装的 Skill
2. **选择工具** — 勾选要安装到哪些 AI 工具（自动检测本机已安装的）
3. **预览确认** — 确认后执行
4. **执行安装** — 复制文件到各工具目录，汇总结果

也可以直接安装指定技能：

```bash
luminae-helper skill install ai-development-workflow --tool codex
luminae-helper skill install git-push --tool claude-code
luminae-helper skill --help
```

`skill install` 根据最新正式 Tag 校验技能 ID，只安装到 `--tool` 指定的已安装宿主。技能 ID 不存在时会列出当前可安装的条目。无法更新来源时命令会报错，可进入交互流程选择已验证的旧缓存。

### 安装插件

运行 `luminae-helper`，选择「安装 / 更新 → 插件」，再选 Codex 或 Claude Code。留空使用 Helper 的受管清单，目前两端都提供 `ai-development-workflow`。输入本地插件目录可安装该宿主兼容的外部包。

```bash
luminae-helper plugin install ai-development-workflow --tool codex
luminae-helper plugin install ai-development-workflow --tool claude-code
luminae-helper plugin install my-plugin --tool claude-code --source "/path/to/local-plugin"
```

省略 `--tool` 时使用 Codex。`--source` 接受独立插件目录和本地来源目录。Codex 识别 `.codex-plugin/plugin.json` 或 `plugin.json`，优先读取 `.agents/plugins/marketplace.json`。Claude Code 使用 `.claude-plugin/plugin.json` 和 `.claude-plugin/marketplace.json`。本地来源只提供目录内的本地插件。

Helper 调用相应宿主的 CLI 安装。Codex 用户在 Settings → Hooks 或 `/hooks` 审阅并信任 Hook。Claude Code 在新会话或 `/reload-plugins` 后加载插件，可通过 `/hooks` 查看。压缩续接依赖 Python 3.9+，两端分别登记各自的统筹会话。插件卸载由宿主管理。

### 卸载技能

再次运行 `luminae-helper`，在第一步主菜单中选择「卸载」。

卸载时只会删除带有 `managed-by: luminae-helper` 标识的文件，不会误删用户手动创建或 AI 工具自带的同名文件。

安装时，目标宿主已有非本工具管理的同名 Skill 或旧命令文件会跳过并说明冲突。更新受管旧命令时，成功安装 Skill 后才移除旧文件。识别兼容顶层旧字段和 metadata 新字段，仅接受有效 frontmatter 中的 `luminae-helper` 管理者；正文示例、其他管理者、重复键、冲突或损坏内容不认领。公共安装不接管软链或链接形式的 SKILL.md；发现与卸载不会顺带迁移文件。

### 其他命令

```bash
luminae-helper --version    # 查看版本
luminae-helper outdated     # 检查 npm registry 是否有新版本
```

### 退出

任何步骤按 `Ctrl+C` 或在导航行选择「退出」即可安全退出，不会产生残留文件。

## 公共技能

| 技能 ID | 用途 |
|---------|------|
| `ai-development-workflow` | 协调跨阶段、多工作区和多会话开发任务 |
| `generate-refactor-docs` | 生成页面、接口和后端链路的重构文档 |
| `git-flow` | 管理 Git Flow feature、release 和 hotfix 分支 |
| `git-push` | 按用户授权执行提交前检查、提交和推送 |
| `identity` | 检测项目类型并设定 Agent 身份 |

实际可安装列表由正式 Tag 决定。公共来源的 `skills/` 优先，旧版本的 `commands/<id>/SKILL.md` 仍可读取和安装为 Skill。旧受管命令在卸载菜单中标为「旧命令」。

## 支持的工具

| 宿主 | `--tool` | Skill 安装目录 |
|------|----------|----------------|
| Claude Code | `claude-code` | `~/.claude/skills/*/` |
| Codex | `codex` | `~/.codex/skills/*/` |
| Cursor | `cursor` | `~/.cursor/skills/*/` |
| Hermes Agent | `hermes-agent` | `~/.hermes/skills/*/` |
| OpenCode | `opencode` | `~/.opencode/skills/*/` |

## 工作原理

### managed-by 标识

复制安装或更新时，在目标文件的 YAML frontmatter 中写入 `metadata.managed-by`；已选中的受管旧副本自动迁移顶层字段，源文件保持不变：

```yaml
---
name: git-push
description: ...
metadata:
  managed-by: luminae-helper
---
```

安装与卸载都只碰带有此标识的文件/目录，保护用户手动创建的内容。

### 安全设计

- **原子替换** — 目录安装先复制到临时路径，成功后再重命名替换，中途失败不影响已有文件
- **备份恢复** — 替换前保留旧目录备份，替换失败自动回滚
- **识别保护** — 卸载只移除标记过的内容，不会误删

## 卸载 luminae-helper

```bash
npm uninstall -g luminae-helper
```

注意：卸载 CLI 不会清除已安装到各工具目录的 commands/skills 文件。如需清理，使用 `luminae-helper` 的卸载流程（在第一步主菜单选择卸载），或手动删除对应目录下的文件。

## 开发

### 公共技能来源与缓存

源仓库为 `https://github.com/evenweiss/ai-skills.git`。交互安装 Skill 和 `skill install` 都会检查最大正式版本 Tag（`X.Y.Z` 或 `vX.Y.Z`，不含预发布版本），不跟随未发布的 main。界面显示实际 Tag 和提交。

缓存位于 `~/.cache/luminae-helper/public-skills/`：首次 clone，后续 fetch。只长期保留最近一次成功获取的正式版本；临时目录和无人使用的历史快照会自动清理。并发安装登记独立占用，旧快照在最后一个使用者退出后才回收，下载与清理不会中断其他安装。正常完成、返回、取消或失败都会释放占用；异常退出的遗留占用与临时数据在下次缓存操作时回收。

不要编辑缓存；工作树或 HEAD 被修改的快照会被保留并提示，不会自动覆盖或删除，因此这类快照需要自行保留改动后处理。

交互安装遇到更新失败时，会显示有效旧缓存的 Tag/提交，默认返回；只有明确选择才使用旧缓存安装，且提示未确认是最新版本。没有有效缓存时停止本次安装。删除缓存后，下次安装会重新下载；已安装的受管内容仍可离线卸载，包括新版本中已移除的条目。

安装继续采用复制方式；更新缓存不会自动修改已安装技能，需要再次选择安装 / 更新。公共技能保留覆盖保护，公司内部技能不属于本工具。

### 测试与发布

```bash
npm test
npm pack
```

测试使用临时源码、Git 仓库和目标目录，不依赖本地公共技能副本。打包和 npm 安装不再触发技能下载。`commands/`、`skills/` 的旧生成目录仍被忽略，但不会进入 npm 包；旧 `sync-skills` 脚本已移除。受管插件的包和两端清单存放于 `codex-plugins/`，随 npm 包分发。更新受管插件时同步包内容和插件清单版本。

需要正式发布 CLI 时再执行 `npm publish`，公共技能的新 Tag 不要求 CLI 同步发版。

## Library API

可作为 npm 包引入，自定义包装器复用 CLI 引擎：

```js
import { runCli } from "luminae-helper";

const code = await runCli({
  argv: process.argv.slice(2),
  packageRoot: import.meta.dirname,  // 包装器的 package.json 所在目录
});
process.exit(code);
```

`packageRoot` 用于包装器名称、版本和 registry 查询；公共技能统一使用运行时仓库缓存。

迁移注意：`packageRoot` 不再作为公共技能分发源，包装器无需打包自己的 `commands/`、`skills/` 或执行同步钩子。已安装技能的管理标识保持兼容。


包装器需要自行组织主菜单时，复用单次操作入口：

```js
import { runSkillOperation } from "luminae-helper";

const code = await runSkillOperation("install", { packageRoot: wrapperRoot });
// 或 runSkillOperation("uninstall", { packageRoot: wrapperRoot })
```

只接受 `install` / `uninstall`，非法操作会拒绝。入口不展示引擎自己的主菜单，完成或取消后返回控制权；嵌入流程的操作结束提示为返回主菜单。操作异常返回 `1`，正常或取消返回 `0`。缓存、覆盖保护、复制安装、离线卸载和快照占用释放继续由共享实现负责。独立运行 `luminae-helper` 仍使用原菜单，`runCli()` 的版本命令保持不变。
