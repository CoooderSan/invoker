# invoker doctor

`doctor` 用于检查当前 host 是否已满足 skill 的运行条件。

Invoker 会把问题表达为三类：
- 缺依赖：例如 CLI 未安装或版本不满足
- 未配置：例如 env/resource 缺失
- 未认证：例如 token 未设置

另外，`doctor` 也会检查 `requires.skills` 中声明的依赖 skill 是否可用：
- 必需依赖缺失：`error`
- 可选依赖缺失：`warning`
- 默认沿用父 skill 的同一 host 语义进行解析

输出包括：
- manifest/sidecar 路径
- 每项检查结果
- overall 状态
- 简洁摘要

`doctor` 的判断对象始终是 host 上当前这份 skill，而不是 registry 里的静态记录。registry 只保存最近一次观察摘要。
