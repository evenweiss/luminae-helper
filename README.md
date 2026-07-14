# luminae-helper

AI 编程工具的 skills/commands 管理 CLI。一键将公共 AI agent 技能安装到 Claude Code、Cursor、Codex、Hermes Agent、OpenCode、Trae 等工具中。

npm 包在构建时将所有内容打包，运行时纯本地操作文件系统，不访问网络。

## 前置条件

- Node.js >= 18.0.0
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

安装时会在目标文件的 YAML frontmatter 中注入 `managed-by: luminae-helper`：

```yaml
---
name: git-push
description: ...
managed-by: luminae-helper
---
```

卸载时只删除带有此标识的文件/目录，保护用户手动创建的内容。

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

### 同步公共技能

`commands/` 和 `skills/` 是构建产物（gitignored）。本地开发时，保持 `ai-skills` 为同级目录或设置环境变量：

```bash
git clone https://github.com/evenweiss/ai-skills.git ../ai-skills
LUMINAE_SKILLS_SOURCE=../ai-skills npm run sync-skills
```

脚本会扫描 `ai-skills/commands/` 和 `ai-skills/skills/`，将包含 `SKILL.md` 的子目录复制到本项目的对应目录。

### 发布

```bash
npm publish
```

发布前 `prepublishOnly` 钩子以 `--strict` 模式运行同步脚本，确保至少有一个 command 或 skill 被打包。

### 项目结构

```
luminae-helper/
├── src/
│   ├── cli.js                  # 入口
│   ├── index.js                # runCli() 导出
│   └── lib/
│       ├── constants.js        # 工具定义、技能发现、安装目标生成
│       ├── installer.js        # 安装/卸载逻辑
│       ├── ui.js               # 交互式 TUI（inquirer）
│       └── checkbox-with-action-rows.js  # 带功能行的多选组件
├── scripts/fetch-skills.js     # 构建时技能同步脚本
├── commands/                   # 构建产物（gitignored）
├── skills/                     # 构建产物（gitignored）
└── package.json
```

## Library API

可作为 npm 包引入，自定义包装器（如 `kfz-skills-helper`）复用 CLI 引擎：

```js
import { runCli } from "luminae-helper";

const code = await runCli({
  argv: process.argv.slice(2),
  packageRoot: import.meta.dirname,  // 指向你自己的 commands/ skills/
});
process.exit(code);
```

`packageRoot` 让包装器提供自己的 `commands/` 和 `skills/`，复用相同的交互式安装引擎。参见 [kfz-skills-helper](https://github.com/evenweiss/kfz-skills-helper)。
