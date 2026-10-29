# Changelog

## 1.1.2

- 安装时目标已存在且非本工具安装（缺 `managed-by`）→ 跳过并在结果表标「已跳过」，不再覆盖用户自建技能目录。
- 复制技能目录时跳过软链，避免把包外文件内容带进工具目录。
- 移除未使用的 `runCommand`（原实现在 win32 下启用 shell）。

## 1.1.1

- 选择命令/技能时默认全选：直接回车即安装全部，`a` 全选 / `i` 反选仍可用。

## 1.1.0

- 新增 ai-development-workflow skill：按任务规模组织 AI 辅助开发协作，维护版本基线、环境受限验证与阶段验收交接。
- README 技能表补齐 git-flow 与新技能条目。

## 1.0.5

- 新增 git-flow skill：Git Flow feature/release/hotfix 分支的创建、检出与 finish 流程。

## 1.0.4

- git-push：截图自检改为条件触发——渲染结果可静态确认或项目需登录态/启动成本高时跳过，审查结论注明「未经渲染验证」。

## 1.0.3

- git-push 重写为授权边界版：新增 UI 改动提交前截图自检规则。

## 0.0.12

- Split the public CLI engine into its own `luminae-helper` repository.
- Load public command/skill content from `evenweiss/ai-skills` at build time.
- Export `runCli()` so wrapper packages can reuse the CLI engine with their own bundled content.
