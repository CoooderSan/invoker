# Making Skills Runnable

推荐流程：

1. `invoker scan <skill>`
   - 看 skill 最终声明了什么依赖，以及它当前来自哪个 host
2. `invoker doctor <skill>`
   - 看这台 host 机器现在缺什么，包括 CLI、认证、配置和依赖 skill
3. `invoker install --dry-run <skill>`
   - 看自动/手动步骤
4. `invoker install <skill>` 或 `invoker fix <skill>`
5. `invoker run <skill>`

如果 skill 来自特定 host，建议显式带上 `--host`，这样依赖 skill 的解析也会与 host 语义保持一致。

如果你先执行了 `register` / `unregister`，也要记住那只是更新 Invoker control plane 的摘要索引；真正是否可运行，仍以 host 上的重新扫描和 `doctor` 结果为准。
