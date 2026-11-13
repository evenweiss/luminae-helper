## ADDED Requirements

### Requirement: 双宿主插件安装入口
Luminae Helper SHALL 在现有「安装 / 更新」入口中提供 Codex 和 Claude Code 插件安装，并提供 `plugin install <技能名> [--tool codex|claude-code] [--source <本地包目录>]`。默认 SHALL 只提供 Helper 随包发布的受管清单。显式提供 `--source` 或在交互中输入本地目录时，SHALL 允许安装该目录中的外部本地插件。两个入口 SHALL 交由目标宿主 CLI 注册对应来源及安装插件。交互入口 SHALL 在调用写操作前展示插件和来源并等待确认。

#### Scenario: 按技能名安装受管插件
- WHEN 用户仅指定受管技能名
- THEN 从 Helper 随包提供的来源安装对应插件。非受管名称和限定来源的选择器返回错误。

#### Scenario: 交互安装本地插件
- WHEN 用户提供独立插件目录或含对应宿主 marketplace 清单的本地目录、选择插件并确认
- THEN 注册该目录并安装所选插件，并提示在目标宿主中查看或审阅 Hook。

#### Scenario: 取消预览
- WHEN 用户退出或返回且未确认安装
- THEN 不注册来源且不安装插件。

#### Scenario: 命令安装与错误处理
- WHEN 用户使用有效技能名和可选本地来源调用安装命令
- THEN 安装所选插件并报告目标宿主的结果。无效参数或安装失败时返回非零退出码。

### Requirement: 插件安装边界
Luminae Helper SHALL 保留 Codex 的 Hook 信任机制和原技能安装、卸载及包装器接口，且 SHALL NOT 自动卸载同名独立技能。

#### Scenario: 包装器执行单次技能操作
- WHEN 包装器调用原有 `runSkillOperation`
- THEN 进入原技能操作，并按既有协议返回调用者。

### Requirement: 双宿主压缩续接
插件 SHALL 在 Codex 和 Claude Code 上使用各自的 SessionStart 配置。压缩后，只有已登记为统筹的任务能向该会话注入技能及协调记录入口。两端 SHALL 使用各自配置目录保存登记。

#### Scenario: 普通或兼任会话压缩
- WHEN 当前会话压缩完成
- THEN 恢复该宿主中已登记的统筹任务。未登记会话保持静默，其他任务的执行和验收角色保持各自分工。
