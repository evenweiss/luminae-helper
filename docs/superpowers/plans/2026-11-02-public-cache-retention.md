# Public cache retention Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in the current checkout. User approved the approach, tests, anonymous commit and push; no new branches or npm publication.

**Goal:** 保留最近一次成功获取的正式版本，清理临时数据及闲置旧快照，保护并发安装。
**Architecture:** 跨进程短期操作锁串行化刷新/占用登记/回收；每个安装持有快照租约，读取期间不持有全局锁。正常退出释放租约，后续操作回收已退出进程的记录。保留本地修改。
**Tech Stack:** Node.js fs/child_process，Git，Vitest；无新增依赖。
**Spec:** ../../../openspec/changes/public-cache-retention/specs/public-skills/spec.md

## Global Constraints
保留当前缓存、在用快照和用户本地修改；不删除其他目录；包装器同步精确引擎依赖；匿名邮箱、无签名；不发布 npm。

## Review Focus
并发刷新与清理；缓存确认期间占用；取消/异常释放；崩溃后锁与租约回收；旧安装结束不回退当前版本。

### Task 1: 缓存生命周期
- [x] 先写失败测试：多个读者、最新保留、旧版最后释放才删除、临时数据失败时清理、保留本地修改。
- [x] 新增 src/lib/cache-lifecycle.js：withCacheLock、leaseSource、cleanupCache。操作锁使用预写 owner 的目录原子发布，回收时只删已退出 owner 文件并 rmdir 空锁，避免删掉新 owner。
- [x] public-source.js 刷新和 acquireCachedSource 在锁内登记占用、更新指针、回收；release 幂等并触发回收。
- [x] ui.js try/finally 覆盖安装全流程和旧缓存确认，正常/取消/异常都释放。
- [x] 用真实子进程测试跨进程占用及崩溃回收，全套测试通过。

### Task 2: 包装器和交付
- [ ] 更新契约、README、CHANGELOG，独立审查和打包测试。
- [ ] 引擎匿名提交推送后，包装器锁定该提交并同步 lock。
- [ ] 包装器重装、测试和解包验证通过后，匿名提交推送，核对两仓库远端和工作区。

## 验证记录

公共引擎 78 项测试通过。真实子进程验证占用释放及崩溃回收；独立审查相关 22 项测试通过且无阻断发现。包装器使用本次实际引擎 tar 包时 11 项测试通过。打包引擎临时 HOME 真实拉取 ai-skills 0.3.0，释放后仅保留当前快照且无租约、临时目录。精确依赖与最终打包验证随包装器提交完成。未安装 OpenSpec CLI，未执行其格式校验。
