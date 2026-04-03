# Making Skills Runnable

推荐流程：

1. 先在目标 host 安装 skill
   - 用户入口应优先是 Claude Code / Codex 等宿主里的 skill
2. `invoker bootstrap <skill>`
   - 先确保 Invoker CLI 可用，再把目标 skill materialize / install / register 到当前 host，并返回 readiness 结果
3. `invoker doctor <skill>`
   - 看这台 host 机器现在缺什么，包括 CLI、认证、配置和依赖 skill
4. `invoker install --dry-run <skill>`
   - 看自动/手动步骤
5. `invoker install <skill>` 或 `invoker fix <skill>`
6. `invoker run <skill>`

如果本机尚未全局安装 `invoker`，也可以直接走一次性入口：

```bash
npx -y @cooodersan/invoker bootstrap <skill> --json
```

如果 skill 来自特定 host，建议显式带上 `--host`，这样依赖 skill 的解析也会与 host 语义保持一致。

如果你先执行了 `register` / `unregister`，也要记住那只是更新 Invoker control plane 的摘要索引；真正是否可运行，仍以 host 上的重新扫描和 `doctor` 结果为准。
