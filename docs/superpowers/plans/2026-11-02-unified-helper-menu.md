# Unified helper menu Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in the current checkouts. User confirmed the unified menu and shared engine. After validation, the user authorized pushing the engine first, then pinning the wrapper to that exact commit, testing and pushing the wrapper. Use anonymous identity without signing; no new branches, worktrees or npm publication.

**Goal:** 统一公共/私有入口，选择时才触发对应来源，保留共享实现。
**Architecture:** 引擎导出 runSkillOperation(action, options) 并执行一次现有 flow；包装器以独立 menu 模块组织入口，私有 operation 保留原逻辑。开发阶段关联 file:../luminae-helper 便于重装复现；提交交付时将包装器更新为已推送引擎的精确 Git 提交。
**Tech Stack:** 现有 Node.js ESM、Inquirer、Vitest、node:test，无新增依赖。
**Spec:** ../../../openspec/changes/shared-single-operation/specs/public-skills/spec.md

## Global Constraints
保留独立引擎菜单、版本命令、缓存租约释放、覆盖保护、私有软链流程；按最新授权顺序提交推送，并保持匿名邮箱和无公司签名；不发布 npm，不访问真实技能目录/公司仓库。

## Review Focus
完成/取消/异常交还控制权；主菜单退出不联网；卸载分流及返回；一方失败后另一方可用；本地依赖和打包实际加载新引擎。

### Task 1: 引擎入口
- [x] test/index.test.js 先验证 runSkillOperation 的 action 校验、单次路由与元命令兼容，观察失败。
- [x] src/index.js 新增 runSkillOperation(action, options={}) -> Promise<number>，复用错误处理，非法 action 拒绝。
- [x] src/lib/ui.js 新增 runOperation(action)，复用 runFlow；嵌入流程的退出/完成提示改为返回主菜单，不改变独立菜单行为。
- [x] test/ui-source.test.js 覆盖不展示主菜单、完成/取消释放、离线卸载，npm test 全套通过。

### Task 2: 包装器组织
- [x] 新增 src/menu.js 的 runMainMenu({select,runPublic,runPrivate,report})，注入现有实际操作，测试公共/私有/卸载分流、取消、错误隔离、退出。
- [x] src/cli.js 元命令仍调用 runCli；常规入口调用统一菜单；私有流程从原 interactive 提取，保留安装/更新/卸载实现。
- [x] 更新 package.json/lock 本地引擎引用及打包清单；README/CHANGELOG 同步行为。
- [x] 两仓库全套测试、实际 TUI 的安全路径检查、打包解包验证和独立审查；保留未提交修改。

## 验证结果

- 公共引擎 npm test：85/85；包装器 npm test：19/19，均使用 Node.js 24。
- 实际包装器 tar 包解包后：9/9 菜单与共享引擎集成测试通过；新 runSkillOperation 导出可调用，非法操作拒绝；引擎关键文件与源码逐字节一致。
- 真实 PTY、临时 HOME、Git 禁用桩：公共下载失败后返回主菜单；私有空选返回；卸载子菜单 Ctrl+C 返回；主菜单退出码 0。仅一次受控公共 Git 失败，无真实 GitHub/GitLab 拉取或真实技能目录写入。
- 独立审查无可执行问题，两仓库 diff --check 通过。未修改私有技能底层 clone/pull/软链保护。
- 初始验证阶段按要求保留未提交修改和同级 file: 引擎引用。用户随后授权先提交推送共享引擎，再将包装器锁定其精确提交、测试、提交推送；不发布 npm。
- 未运行真实公司 GitLab 网络或 Python 依赖安装；既有私有功能使用临时本地 Git 仓库回归测试。未安装 OpenSpec CLI，未执行其格式校验。
