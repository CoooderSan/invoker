# invoker run

`run` 会在执行前先调用 `doctor` 作为 gate，确保当前 host 已具备运行条件。

- 如果 readiness 存在 blocking error，则阻断运行
- 如果 readiness 只有 warning，则提示后继续运行
- 如果 trust 为 `warning` 或 `error`，当前只告警，不阻断运行

当前会根据问题类型给出更准确的下一步建议，例如：
- 缺 CLI：先看 `doctor`
- 缺 token/env/resource：先看 `doctor` 或 `install --dry-run`
- 当 host 已知时，建议里会带上对应的 `--host`

这意味着：
- `overall` 仍代表 readiness gate 语义
- `overallStatus` 才代表 readiness + trust 的综合状态

`run` 关注的是 host 上该 skill 是否可运行；Invoker 自己仍只负责控制与诊断，不替代 host 执行环境。
