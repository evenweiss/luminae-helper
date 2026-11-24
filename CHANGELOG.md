# Changelog

## 未发布

### Changed

- 交互式插件安装改为插件优先：选完插件和宿主后直接安装，不再二次确认；结果表列出成功、失败和不支持的组合及原因（如宿主清单中没有该插件）。
- 交互式插件安装不再询问本地插件目录，统一使用技能仓库正式 Tag；本地目录安装仅保留 `plugin install --source` 供调试。
- 交互卸载插件改为多选：先勾选宿主，再逐个宿主勾选插件，统一确认后批量卸载；默认不勾选。
- `outdated` 同时检查技能仓库：对比本地已验证快照与远端最新正式 Tag，提示更新命令；本地无快照时给出安装提示。
- 源码刷新前置检查更友好：缺少 Git 时提示先安装 Git（用于拉取技能与插件源码），网络类失败归并为「网络或代理不可用」并附最后一行原因。
- 界面与文档统一用「技能 / 插件」，技能相关的菜单、提示和 README 不再混用英文 Skill。

### Added

- 启动时显示概览：本地技能快照、远端最新正式 Tag（`git ls-remote` 只查不拉）、已安装数量。已安装内容只在启动和安装/卸载结束后（无论成败）扫描；进入「已安装」页只展示最近一次结果。
- `skill uninstall` 与批量操作：`skill install` / `skill uninstall` 支持多个技能 ID 和 `--all`；卸载完全离线，只删受管技能。
- 新增「查看已安装」：主菜单入口与 `luminae-helper list`，按宿主列出受管技能/插件与插件版本，并显示来源快照。
- 插件安装新增 Cursor、Hermes Agent、Pi 三个宿主；卸载入口按「技能 / 插件」区分，五个插件宿主都支持卸载 Helper 管理的插件。
- 插件安装支持同时选择多个宿主和多个插件，逐项安装并汇总结果（命令行仍为单宿主单插件）。插件复制到各宿主的插件目录，Cursor 依赖 Reload Window，Hermes Agent 自动 `plugins enable`，Pi 自动 `pi install` 登记。

### Breaking Changes

- 插件不再随 npm 包分发，改为安装时从技能仓库最新正式 Tag 的快照读取（与技能共用缓存）；ai-skills 更新插件后无需升级本工具。删除 `prepare:plugins`/`prepack` 与 `codex-plugins/` 产物。
- 移除包装器接入：删除 `runSkillOperation`、`packageRoot` 选项和引擎再导出，包内不再提供 Library API。kfz-skills-helper 0.0.37 起已独立，无调用方。
- 界面与文档不再使用「公共技能」：与 kfz 拆分后本工具只处理一套技能来源，「公共」已无区分意义。

## 2.0.0

### Changed

- 从 ai-skills 生成受管的 AI 开发协作插件包，移除 Helper 仓库中的重复源码和用例。npm 安装用户继续使用 `luminae-helper plugin install ai-development-workflow --tool codex` 或对应的 Claude Code 安装命令。
- 随包插件使用一份共享技能，更新统筹交接、操作授权和独立验收规则。插件源码同时提供 Cursor、Pi 和 Hermes Agent 的安装及续接入口。

### Breaking Changes

- 从 Helper 源码运行测试、打包或安装受管插件时，需要检出包含插件的 ai-skills（本版验证使用 `0.9.0`）。默认查找同级 `../ai-skills`，也可用 `LUMINAE_AI_SKILLS_DIR` 指定。直接从源码安装插件前执行 `npm run prepare:plugins`。
- 公共目录中的 `ai-development-workflow` 已从独立 Skill 迁移为插件。现有独立 Skill 可通过原卸载入口移除，再用 `luminae-helper plugin install` 安装插件。

## 1.3.3

- 随包分发 ai-development-workflow 0.9.2。明确阶段结果后的统筹续接、必要的用户操作请求及等待回复和受阻收口条件。

## 1.3.2

- 随包分发 ai-development-workflow 0.9.1。Codex 审查弹窗显示「校验派单回传安排」和「压缩后恢复统筹上下文」。

## 1.3.1

- 随包分发 ai-development-workflow 0.9.0。明确启用的 Codex 统筹可使用业务工作区只读权限，并在派单前校验任务、回传安排和独立检查点。普通开发会话沿用宿主默认设置。
- 补齐会话身份、回传责任、独立监督及临时 Bug 排查规则。Codex 和 Claude Code 继续支持各自的压缩续接 Hook。

## 1.3.0

- 公共技能统一安装为 Skill 目录。更新选中的受管旧命令时，先安装 Skill 再移除旧文件，仍支持离线卸载旧命令。
- 增加 `skill install <技能ID> --tool <宿主ID>`，按当前正式目录安装指定技能。
- 在交互安装流程中支持 Codex 和 Claude Code 插件，同时支持 `plugin install` 命令。默认按技能名安装 Helper 随包提供的受管插件，也可显式指定外部本地包。ai-development-workflow 插件 0.8.1 在两端均包含压缩续接 Hook，按各自宿主规则加载。

## 1.2.3

- 验证运行时安装 / 更新可获取 ai-skills 0.5.0 正式 Tag，完整复制文档执行者、工作区绑定和接替所需引用及配置。
- 公共技能继续按最新正式 Tag 获取，不内嵌快照；保留旧管理标识迁移、非受管同名内容和外来软链保护，以及离线卸载。

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
