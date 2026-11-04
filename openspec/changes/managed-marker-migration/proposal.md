# 管理标识兼容迁移契约

来源：本聊天用户要求按兼容迁移方案修改两个工具；更新已选择的受管 commands/skills 自动迁移顶层字段；重点保护非工具管理同名内容。用户授权审核与隔离回归通过后分别提交，不推送、不发布。

## 范围与实现选择

修改 ai-toolkit 下既有 main checkout 的 luminae-helper 与 kfz-skills-helper。不修改另一份 github checkout、全局 npm 安装、真实用户技能目录或内部技能源仓库。
共享引擎新增管理标识解析模块及 isManagedSkill(content) 公共出口，包装器复用；使用 yaml@^2.9.1 的文档 API，避免正则误认正文、损坏或重复键，并保留无关元数据与注释。没有足以安全处理 YAML 的现有生产依赖，新增这一个解析依赖；不自写 YAML 子集解析器。
保留共享管理者值 luminae-helper，不把任意 managed-by 值视为本工具所有。
