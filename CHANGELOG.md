# Changelog

## 1.2.2

- 公共技能的技能选择、目标工具、确认预览、兼容转换确认面板都固定提供「✕ 退出」；嵌入包装器时额外保留「↩ 返回主菜单」。
- 面板里显式选「退出」时流程返回 `abort`，包装器据此结束整个工具；「返回主菜单」与操作完成仍返回 `exit`，两者不再混淆。

## 1.2.1

- 导出 `checkboxWithActionRows` 与 `NAV_BACK` / `NAV_EXIT`，供包装器的勾选列表复用「返回 / 退出」功能行。

## 1.2.0

- 新增 runSkillOperation 单次公共安装/卸载入口，供包装器组织统一主菜单；复用现有保护和租约释放，独立菜单与版本命令保持兼容。

- 缓存只长期保留最近一次成功获取的正式版本，自动清理临时数据和闲置历史快照；通过跨进程占用保护并发安装，并在退出后回收，保留本地修改。

- 公共技能改为安装 / 更新时拉取 ai-skills 最新正式 Tag，显示版本及提交；不再随 npm 包内置或在构建时下载。
- 使用专用缓存与独立提交快照；下载失败必须明确选择才使用有效旧缓存，无缓存则停止安装。
- 从已安装受管内容发现离线卸载条目，不依赖源码缓存；保留现有覆盖保护。
- 包装器迁移：packageRoot 仅用于包身份和版本查询，移除公共内容打包与 sync-skills 钩子。

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
