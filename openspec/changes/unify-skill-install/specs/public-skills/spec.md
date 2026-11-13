## ADDED Requirements

### Requirement: 公共条目统一安装为 Skill
安装器 SHALL 为当前受支持宿主生成目录安装目标。公共来源 SHALL 支持读取旧 `commands/<id>/SKILL.md`。相同 ID 同时存在时 SHALL 优先使用 `skills/<id>`。

#### Scenario: 更新旧受管命令
- WHEN 用户选中安装已有同名受管命令的公共技能
- THEN 先成功安装完整 Skill 目录，再移除该条受管旧命令。

#### Scenario: 保护用户同名命令
- WHEN 目标宿主已有用户管理的同名命令或 Skill
- THEN 跳过安装并说明冲突。卸载只处理受管内容。

### Requirement: 按 ID 安装指定技能
独立 CLI SHALL 支持 `skill install <技能ID> --tool <宿主ID>`。命令 SHALL 校验宿主及其可用性，从本次成功获取的正式来源查找该 ID，安装到所选宿主并报告结果。

#### Scenario: 当前正式目录不含该技能
- WHEN 给定 ID 不在当前正式来源中
- THEN 报告当前可安装的技能 ID，返回非零退出码，并保持宿主文件。

#### Scenario: 无法刷新正式来源
- WHEN 本次无法取得正式来源
- THEN 返回错误，交互安装仍可按现有流程选择有效缓存。
