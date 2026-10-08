# Changelog

## 1.0.4

- git-push：截图自检改为条件触发——渲染结果可静态确认或项目需登录态/启动成本高时跳过，审查结论注明「未经渲染验证」。

## 1.0.3

- git-push 重写为授权边界版：新增 UI 改动提交前截图自检规则。

## 0.0.12

- Split the public CLI engine into its own `luminae-helper` repository.
- Load public command/skill content from `evenweiss/ai-skills` at build time.
- Export `runCli()` so wrapper packages can reuse the CLI engine with their own bundled content.
