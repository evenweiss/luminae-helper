# Runtime public skills Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session; user authorized implementation and final commit/push. User checkout/branch rules override isolation suggestions.

**Goal:** 公共技能与 helper 发版解耦。
**Architecture:** 专用 bare 缓存 fetch Tag，按提交生成独立快照；选择安装时加载快照，卸载时扫描受管目标。包装器 锁定新引擎提交。
**Tech Stack:** Node.js ESM、Git、Vitest、node:test，无新增运行时依赖。
**Spec:** ../../../../openspec/changes/runtime-public-skills/specs/public-skills/spec.md

## Global Constraints
匿名提交、无公司签名；不发布 npm；保留覆盖保护、内部技能流程与包装器身份。

## Review Focus
正式 Tag 数字排序和 peeled commit；断网拒绝缓存；缓存被修改；缺失缓存离线卸载；打包后包装器依赖确实使用新引擎。

### Task 1: 源与安装集成
- [x] 在 test/public-source.test.js 用临时 Git 仓库验证 Tag、fetch、快照、缓存损坏和首次失败；先看失败。
- [x] 新增 src/lib/public-source.js：refreshPublicSource({repo, cacheDir})、readCachedSource({repo, cacheDir})，返回 {root,tag,commit}。
- [x] constants.js 分离技能根并支持刷新；离线发现受管安装项；测试源变更与卸载。
- [x] ui.js 只在安装选择前刷新源，失败时选择缓存；index.js 保留版本路径。
- [x] npm test 全套通过。

### Task 2: 分发与包装器
- [x] 移除两个 package.json 的源下载生命周期与打包目录，更新 README/CHANGELOG；旧同步脚本退出分发。
- [x] 测试使用独立固定 fixtures，不依赖忽略的本地快照。
- [ ] 隔离 pack/unpack 验证源不内置、版本路径离线；引擎提交后 包装器 锁定精确提交更新 lock。
- [ ] 两仓库测试、最终独立审查、匿名提交/推送及远端 SHA 核对。

## 验证记录

公共引擎 69 项测试通过；独立审查发现的首次并发 clone/快照发布竞态已用真实并发测试复现并修复。包装器加载本次实际引擎 tar 包时 11 项测试通过。引擎打包内容不含公共技能，临时 HOME 真实拉取 ai-skills 0.3.0 后安装、删除缓存再卸载与包装器版本查询均通过。精确 Git 依赖与推送的最终验证随包装器提交记录。OpenSpec CLI 未安装，未执行 CLI 格式校验。
