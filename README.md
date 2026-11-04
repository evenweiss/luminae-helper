# luminae-helper

AI 编程工具的 skills/commands 管理 CLI。一键将公共 AI agent 技能安装到 Claude Code、Cursor、Codex、Hermes Agent、OpenCode、Trae 等工具中。

公共内容不内置在 npm 包中。选择「安装 / 更新」时从 `ai-skills` 拉取最新正式 Git Tag，再复制到目标工具。首次需要网络与 Git；卸载和 `--version` 不需要拉取技能。

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

进入交互式菜单，分四步：

1. **选择内容** — 勾选要安装的 commands / skills
2. **选择工具** — 勾选要安装到哪些 AI 工具（自动检测本机已安装的）
3. **预览确认** — 确认后执行
4. **执行安装** — 复制文件到各工具目录，汇总结果

### 卸载技能

再次运行 `luminae-helper`，在第一步主菜单中选择「卸载」。

卸载时只会删除带有 `managed-by: luminae-helper` 标识的文件，不会误删用户手动创建或 AI 工具自带的同名文件。

安装同理：目标位置已有同名的非本工具内容时直接跳过（结果表标「已跳过」），不会覆盖。识别兼容顶层旧字段和 metadata 新字段，仅接受有效 frontmatter 中的 `luminae-helper` 管理者；正文示例、其他管理者、重复键、冲突或损坏内容不认领。公共安装不接管软链或链接形式的 SKILL.md；发现与卸载不会顺带迁移文件。

### 其他命令

```bash
luminae-helper --version    # 查看版本
luminae-helper outdated     # 检查 npm registry 是否有新版本
```

### 退出

任何步骤按 `Ctrl+C` 或在导航行选择「退出」即可安全退出，不会产生残留文件。

## 包含内容

### Commands（命令）

| 命令 | 用途 |
|------|------|
| `git-push` | 代码审查 → 提交信息 → commit → push 完整工作流 |

### Skills（技能）

| 技能 | 用途 |
|------|------|
| `ai-development-workflow` | AI 协作开发流程：协调跨阶段、多工作区和多会话任务，覆盖专业分工、回传监控、验证及交接 |
| `git-flow` | Git Flow feature / release / hotfix 分支的创建、检出与 finish，版本号自动计算 |
| `identity` | 检测项目类型，自动设定 agent 身份（前端/后端/全栈等） |

## 支持的工具

| 工具 | command 模式 | skill 模式 | 安装方式 |
|------|:-----------:|:---------:|------|
| Claude Code | ✓ | ✓ | `~/.claude/commands/*.md` / `~/.claude/skills/*/` |
| Codex | ✗ | ✓ | `~/.codex/skills/*/` |
| Cursor | ✗ | ✓ | `~/.cursor/skills/*/` |
| Hermes Agent | ✗ | ✓ | `~/.hermes/skills/*/` |
| OpenCode | ✗ | ✓ | `~/.opencode/skills/*/` |
| Trae | ✓ | ✗ | `~/.trae/commands/*.md` |

### Command vs Skill

- **Command** — 以 `/command-name` 方式触发，安装为单个 `.md` 文件（Claude Code、Trae）
- **Skill** — 作为上下文注入到 agent，安装为完整目录（Codex、Cursor、Hermes、OpenCode）

当技能类型与工具能力不匹配时，CLI 会自动做 fallback 转换（如 command 源安装到只支持 skill 的工具），并在结果中标注。

### 兼容转换

| 场景 | 转换方式 |
|------|---------|
| Command → 仅支持 skill 的工具 | 将 `.md` 文件包装为 skill 目录安装 |
| Skill → 仅支持 command 的工具 | 将目录下的 `SKILL.md` 安装为 `.md` 文件 |

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

源仓库为 `https://github.com/evenweiss/ai-skills.git`。每次选择「安装 / 更新」都会检查最大正式版本 Tag（`X.Y.Z` 或 `vX.Y.Z`，不含预发布版本），不跟随未发布的 main。界面显示实际 Tag 和提交。

缓存位于 `~/.cache/luminae-helper/public-skills/`：首次 clone，后续 fetch。只长期保留最近一次成功获取的正式版本；临时目录和无人使用的历史快照会自动清理。并发安装登记独立占用，旧快照在最后一个使用者退出后才回收，下载与清理不会中断其他安装。正常完成、返回、取消或失败都会释放占用；异常退出的遗留占用与临时数据在下次缓存操作时回收。

不要编辑缓存；工作树或 HEAD 被修改的快照会被保留并提示，不会自动覆盖或删除，因此这类快照需要自行保留改动后处理。

更新失败时，CLI 显示有效旧缓存的 Tag/提交，默认返回；只有明确选择才使用旧缓存安装，且提示未确认是最新版本。没有有效缓存时停止本次安装。删除缓存后，下次安装会重新下载；已安装的受管内容仍可离线卸载，包括新版本中已移除的条目。

安装继续采用复制方式；更新缓存不会自动修改已安装技能，需要再次选择安装 / 更新。公共技能保留覆盖保护，公司内部技能不属于本工具。

### 测试与发布

```bash
npm test
npm pack
```

测试使用临时源码、Git 仓库和目标目录，不依赖本地公共技能副本。打包和 npm 安装不再触发技能下载。`commands/`、`skills/` 的旧生成目录仍被忽略，但不会进入 npm 包；旧 `sync-skills` 脚本已移除。

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
