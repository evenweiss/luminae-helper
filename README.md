# luminae-helper

AI 编程工具的技能和插件安装 CLI。一键将 AI agent 技能安装到 Claude Code、Cursor、Codex、Hermes Agent、OpenCode 和 Pi。

技能和插件的源码都从正式 Tag 获取。启动时只做轻量检查：读取本地技能快照、扫描已安装内容，并用 `git ls-remote` 查远端最新正式 Tag（只查不拉、不写缓存）。初始化完成后清屏，显示 banner 和一行状态摘要（版本与更新状态），过程提示不再残留。启动判断需要更新（或无法确认）时，进入安装面板才拉取；拉取成功一次后本进程不再拉。拉取失败时会询问是否用本地缓存继续，没有可用缓存则停止。安装或卸载结束后（无论成功与否）会重新扫描已安装内容；进入「已安装」页只展示最近一次扫描结果，不再现场检索。版本号统一不带 `v`。技能复制到目标工具，插件按工具复制或登记。首次安装需要网络与 Git；卸载和 `--version` 不需要拉取源码。

## 前置条件

- Node.js >= 18.0.0
- Git（技能和插件的安装 / 更新需要访问 GitHub；缺失时会提示先安装 Git）
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

选择「安装 / 更新 → 技能」，分四步：

1. **选择技能** — 勾选后按回车，或选「下一步」
2. **选择工具** — 勾选要安装到哪些 AI 工具（自动检测本机已安装的），按回车或选「下一步」进入预览
3. **预览确认** — 按工具列出每个技能，确认后执行
4. **执行安装** — 复制文件到各工具目录，汇总结果

也可以直接安装指定技能：

```bash
luminae-helper skill install git-flow --tool codex
luminae-helper skill install git-flow git-push --tool claude-code
luminae-helper skill install --all --tool codex
luminae-helper skill uninstall git-flow --tool codex
luminae-helper skill uninstall --all --tool codex
luminae-helper skill --help
```

`skill install` 根据最新正式 Tag 校验技能 ID，只安装到 `--tool` 指定的已安装工具；可一次给多个 ID，或 `--all` 装全部。技能 ID 不存在时会列出当前可安装的条目。无法更新来源时命令会报错，可进入交互流程选择已验证的旧缓存。

`skill uninstall` 完全离线，只删除该工具上带 `managed-by: luminae-helper` 的技能；可给多个 ID，或 `--all` 卸载该工具全部受管技能。

### 安装插件

运行 `luminae-helper`，选择「安装 / 更新 → 插件」，先多选插件，再选工具：插件清单聚合五个支持插件的工具，选完工具后选「下一步」，在安装预览中确认「确认安装」。结果表列出成功、失败和不支持的组合，并写明失败原因或「该工具清单中没有此插件」。插件清单来自技能与插件源最新正式 Tag（与技能共用同一份快照），五个支持插件的工具都提供 `ai-development-workflow`；ai-skills 发了新 Tag 后下次安装即生效，不需要升级本工具。命令行仍按单个插件、单个工具执行，批量请多次调用。

```bash
luminae-helper plugin install ai-development-workflow --tool codex
luminae-helper plugin install ai-development-workflow --tool claude-code
luminae-helper plugin install ai-development-workflow --tool cursor
luminae-helper plugin install ai-development-workflow --tool hermes-agent
luminae-helper plugin install ai-development-workflow --tool pi
luminae-helper plugin install my-plugin --tool claude-code --source "/path/to/local-plugin"
luminae-helper plugin uninstall ai-development-workflow --tool cursor
```

省略 `--tool` 时使用 Codex。`--source` 接受独立插件目录和本地来源目录，仅用于本地调试（交互流程不提供该入口）。各工具的清单和安装方式：

| 工具 | 清单 | 安装方式 |
|------|------|----------|
| Codex | `.codex-plugin/plugin.json`，优先读 `.agents/plugins/marketplace.json` | `codex plugin add`（经 marketplace 注册） |
| Claude Code | `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` | `claude plugin install`（经 marketplace 注册） |
| Cursor | `.cursor-plugin/plugin.json` | 复制到 `~/.cursor/plugins/local/<名字>/` |
| Hermes Agent | `plugin.yaml` | 复制到 `~/.hermes/plugins/<名字>/` 后 `hermes plugins enable` |
| Pi | `package.json` 的 `pi` 字段 | 复制到 `~/.local/share/luminae-helper/pi-packages/<名字>/` 后 `pi install` |

加载与收尾：Codex 用户在 Settings → Hooks 或 `/hooks` 审阅并信任 Hook。Claude Code 在新会话或 `/reload-plugins` 后加载，`/hooks` 查看。Cursor 需重启或 Developer: Reload Window，且组织策略要允许本地插件导入。Hermes Agent 已自动启用，新会话生效。Pi 已登记到全局设置，新会话加载扩展和技能。压缩续接依赖 Python 3.9+，各工具分别登记统筹会话。目录式工具的安装目录由 Helper 管理（带 `.luminae-helper-plugin` 标记），不会覆盖其它来源的同名插件；卸载见下一节。

### 卸载

再次运行 `luminae-helper`，在第一步主菜单中选择「卸载」，再选「技能」或「插件」。

技能：只删除带有 `managed-by: luminae-helper` 标识的文件，不会误删用户手动创建或 AI 工具自带的同名文件。

插件：可多选工具、再逐个工具多选插件，卸载预览会按工具列出每个插件。列表只列出 Helper 管理的插件——Codex/Claude Code 查工具配置里 `@luminae-helper` 的记录，Cursor/Hermes Agent/Pi 要求目录带 `.luminae-helper-plugin` 标记。卸载分别调用 `codex plugin remove`、`claude plugin uninstall`、`hermes plugins remove`、`pi remove`；Cursor 没有 CLI，直接删除受管目录。其它来源的插件不会出现在列表里。

安装时，目标工具已有非本工具管理的同名技能或旧命令文件会跳过并说明冲突。更新受管旧命令时，成功安装技能后才移除旧文件。识别兼容顶层旧字段和 metadata 新字段，仅接受有效 frontmatter 中的 `luminae-helper` 管理者；正文示例、其他管理者、重复键、冲突或损坏内容不认领。安装不接管软链或链接形式的 SKILL.md；发现与卸载不会顺带迁移文件。

### 查看已安装

主菜单选「已安装」，或直接运行 `luminae-helper list`。按工具列出 Helper 管理的技能与插件，插件带版本；技能源码没有版本字段，版本列显示 `—`。

### 其他命令

```bash
luminae-helper --version    # 查看版本
luminae-helper outdated     # 检查 npm registry 与技能/插件是否有更新（只查不拉）
luminae-helper --help       # 查看用法
```

### 退出

任何步骤按 `Ctrl+C` 或在导航行选择「退出」即可安全退出，不会产生残留文件。

## 技能

| 技能 ID | 用途 |
|---------|------|
| `generate-refactor-docs` | 生成页面、接口和后端链路的重构文档 |
| `git-flow` | 管理 Git Flow feature、release 和 hotfix 分支 |
| `git-push` | 按用户授权执行提交前检查、提交和推送 |
| `identity` | 检测项目类型并设定 Agent 身份 |

实际可安装列表由正式 Tag 决定。`skills/` 优先，旧版本的 `commands/<id>/SKILL.md` 仍可读取和安装为技能。旧受管命令在卸载菜单中标为「旧命令」。

## 支持的工具

| 工具 | `--tool` | 技能安装目录 |
|------|----------|----------------|
| Claude Code | `claude-code` | `~/.claude/skills/*/` |
| Codex | `codex` | `~/.codex/skills/*/` |
| Cursor | `cursor` | `~/.cursor/skills/*/` |
| Hermes Agent | `hermes-agent` | `~/.hermes/skills/*/` |
| OpenCode | `opencode` | `~/.opencode/skills/*/` |
| Pi | `pi` | `~/.pi/agent/skills/*/` |

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

### 技能来源与缓存

源仓库为 `https://github.com/evenweiss/ai-skills.git`。交互安装技能和 `skill install` 都会检查最大正式版本 Tag（`X.Y.Z` 或 `vX.Y.Z`，不含预发布版本），不跟随未发布的 main。界面显示实际 Tag 和提交。

缓存位于 `~/.cache/luminae-helper/public-skills/`：首次 clone，后续 fetch。只长期保留最近一次成功获取的正式版本；临时目录和无人使用的历史快照会自动清理。并发安装登记独立占用，旧快照在最后一个使用者退出后才回收，下载与清理不会中断其他安装。正常完成、返回、取消或失败都会释放占用；异常退出的遗留占用与临时数据在下次缓存操作时回收。

不要编辑缓存；工作树或 HEAD 被修改的快照会被保留并提示，不会自动覆盖或删除，因此这类快照需要自行保留改动后处理。

交互安装遇到更新失败时，会显示有效旧缓存的 Tag/提交，默认返回；只有明确选择才使用旧缓存安装，且提示未确认是最新版本。没有有效缓存时停止本次安装。删除缓存后，下次安装会重新下载；已安装的受管内容仍可离线卸载，包括新版本中已移除的条目。

安装继续采用复制方式；更新缓存不会自动修改已安装技能，需要再次选择安装 / 更新。技能保留覆盖保护，其他来源的技能由各自的工具管理。

### 测试与发布

```bash
npm test
npm pack
```

技能测试使用临时源码、Git 仓库和目标目录；插件测试使用内置 fixture 快照目录。受管插件源码位于 ai-skills 仓库的 `plugins/` 目录（[ai-skills 仓库](https://github.com/evenweiss/ai-skills)），安装时从最新正式 Tag 的快照读取，不再随包分发，也不需要预生成。

生成的插件包随 npm 包分发，继续使用 `ai-development-workflow@luminae-helper`，安装时无需访问 `ai-skills`。测试、打包和 npm 安装过程均无需下载技能。`commands/` 和 `skills/` 的旧生成目录不进入 npm 包。

需要正式发布 CLI 时再执行 `npm publish`，技能的新 Tag 不要求 CLI 同步发版。
