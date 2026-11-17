# Codex 统筹保护

仅用于用户明确启用的 Codex 统筹任务。使用专用统筹会话，同一会话只登记一个受保护任务。这套配置须由用户或获准配置者建立。角色约定、技能加载、压缩续接登记和安装插件本身不会启用保护。

## 启用

1. **限制业务写入**：在宿主给专用统筹会话选用命名权限配置，仅允许写独立的协调目录。协调目录应位于所有业务工作区之外，且不能覆盖 Codex 配置、插件或派单登记。下例路径须替换为真实绝对路径，保留其他会话原有的默认权限设置。宿主若只能启用整会话只读，就把协调记录写入交给已授权的负责人。宿主不能选择或核实实际权限时，把保护记为未启用。

   ```toml
   [permissions.workflow-coordinator.filesystem]
   ":root" = "read"
   "/absolute/path/to/separate-coordination-dir" = "write"
   ```

   主机已采用命名权限时沿用现有 `default_permissions`。首次配置时需要明确原默认权限；不要把 `workflow-coordinator` 设为全局默认。命名权限与旧 `sandbox_mode` 配置不叠加。支持的 app-server 客户端可用 `thread/start` 的 `permissions: "workflow-coordinator"` 选择权限，并核对实际生效值。没有选择入口时可从宿主界面使用经核实的只读权限。启用期间保持原权限。专用 app-server 会话可以使用 `approvalPolicy: "never"`，防止本地命令请求脱离沙箱；其他入口也不要批准命令绕过只读限制。此配置约束本地文件操作，远程写入工具按宿主及服务授权单独控制。开发会话继续使用各自获准的工作区权限。

2. **信任并核对 Hook**：在 Codex 的 Settings → Hooks 或 `/hooks` 审阅并信任本插件的 `SessionStart` 和 `PreToolUse`。确认当前宿主会运行插件 Hook。原有的压缩续接登记仍按[压缩续接](coordination.md#插件的压缩续接)处理。
3. **登记已确认的派单路线**：由用户或获准配置者在 Codex 配置目录下创建 `ai-development-workflow/dispatch/<统筹会话ID>.json`，以宿主确认的会话 ID 命名。目录和文件须在统筹不可写范围内。填入已经核对的目标、身份、回传权限和不依赖统筹或执行者自报的查收触发方式。更换责任方、任务版本或路线时，先更新或撤销登记；编辑登记应一次替换完整文件，避免并发读取半份记录。下面是发给已有会话、只读查收的例子。

   ```json
   {
     "coordinator": "<统筹会话ID>",
     "task": "WF-42",
     "version": "v2",
     "routes": [
       {
         "threadId": "<执行者会话ID>",
         "role": "开发执行者",
         "reporting": {
           "events": ["completed", "stopped", "blocked"],
           "recipient": "<负责收取的统筹会话ID>",
           "entry": "执行者当前任务终稿，经 read_thread 查收",
           "deliverable": "任务版本、结果、制品、自验证据和未做项",
           "mode": "read-only",
           "authorization": "pending"
         },
         "checkpoint": {
           "owner": "<已约定的触发人>",
           "trigger": "<具体时间或独立事件>",
           "entry": "<已获准且可用的查收入口>"
         }
       }
     ]
   }
   ```

   新会话路线用工具调用中的完整 `target` 对象替代 `threadId`。向已有会话派单时，若工具调用传入 `hostId`，路线须登记相同的 `hostId`。不同目标或身份分别登记。确认允许主动回传时，`mode` 写 `active`，`authorization` 写 `approved`，`source` 填可定位的直接用户授权出处；只读查收使用 `pending` 或 `not-enabled`，省略 `source`。路线登记不产生创建、派发、消息或写入授权。

## 派单与检查

在真实任务包正文保留具体职责和回传指令，再增加一段标记为 `workflow-dispatch` 的 JSON 代码块。把登记里的 `task`、`version` 和本路线的 `role`、`reporting`、`checkpoint` 合成一个 JSON 对象。目标仍填写在工具参数里。Hook 检查实际调用的目标和正文。失败按提示补齐，不改走 fork 或 handoff；这些入口在登记期间拒绝。此检查覆盖桌面 MCP 的新建会话和发送消息。因同一入口也能发普通消息，已登记的专用统筹会话通过该入口发出的消息都须匹配一条登记路线。未登记会话直接通过。

双方漏报时，按[独立监督和收取规则](coordination.md#已授权监控的核查与收口)由约定触发人唤起监督者，核对会话与产物。漏报提醒和宿主审批分别按授权执行。

保护应有实际通过和拒绝证据。不要依据「已安装」推定 Hook 运行。Hook 不覆盖其他通道，也不替代沙箱或真实授权。确认结束后由获准配置者移除本会话的派单登记；若已采用压缩续接登记，按原规则撤销。需要后续开发时另用拥有对应权限的执行会话。
