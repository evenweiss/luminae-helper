## ADDED Requirements

### Requirement: 共享单次公共技能操作
包 SHALL 导出 runSkillOperation(action, options)，action 只允许 install/uninstall，options.packageRoot 保持包装器身份。入口 SHALL 执行一次现有公共流程，不展示自己的主菜单；完成、取消、失败后把控制权交回调用者，并释放快照占用。独立 runCli SHALL 保留原菜单及版本命令。卸载 SHALL 不请求公共技能源。

#### Scenario: 包装器直接进入私有流程
- WHEN 用户从统一菜单选择私有技能
- THEN 不执行公共引擎操作，不访问 GitHub；结束或取消回统一菜单。

### Requirement: 统一入口
包装器 SHALL 展示公共安装/更新、私有安装/更新、卸载、退出。卸载 SHALL 再选择公共或私有，并允许返回。主菜单退出 SHALL 直接结束；操作完成、取消和失败 SHALL 返回统一菜单，不自动进入另一类操作。公共复制与私有软链及覆盖保护保持不变。

#### Scenario: 公共失败后继续
- WHEN 公共操作失败
- THEN 提示失败并允许选择私有操作；私有失败同理。

#### Scenario: 元命令
- WHEN --version/-v/outdated
- THEN 复用 runCli 元命令，不展示统一菜单或私有流程。
