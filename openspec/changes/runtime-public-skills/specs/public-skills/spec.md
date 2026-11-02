## ADDED Requirements

### Requirement: 运行时正式版本
安装 SHALL 选择数值最大的 X.Y.Z 或 vX.Y.Z 正式 Git Tag，忽略预发布及非版本 Tag。Tag 指向的提交 SHALL 在缓存中分离检出；列表和复制源 SHALL 为同一快照。包版本查询 SHALL 仍读取包装器 packageRoot。

#### Scenario: 新版本与未发布提交
- WHEN 远端增加正式 Tag，同时 main 含更新提交
- THEN 安装使用新 Tag，而非 main；显示实际 Tag/提交。

### Requirement: 失败和缓存
下载 SHALL 有超时、禁用交互式凭据提示；失败 SHALL 不改变已安装内容。旧缓存 SHALL 校验提交和工作树，且用户明确同意后才能用于安装。首次失败 SHALL 中止。并行更新 SHALL 不修改正在使用的快照。

#### Scenario: 断网
- WHEN 更新失败且存在有效缓存
- THEN 展示缓存版本并询问；拒绝则不安装；无有效缓存则报告错误。

### Requirement: 离线管理和受控分发
卸载 SHALL 从已安装受管内容发现条目，无需源仓库、缓存或网络；保留用户自有内容。npm 包 SHALL 不含公共技能快照或构建下载钩子。包装器 SHALL 使用同一引擎并保留内部技能流程。

#### Scenario: 缓存丢失后卸载
- WHEN 已安装技能不在最新源中或缓存已删除
- THEN 仍可离线卸载受管目录/命令；不改用户目录。
