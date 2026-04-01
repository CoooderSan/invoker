# invoker fix

`fix` 会尝试自动修复 doctor 发现的问题，然后重跑 doctor。

## 当前策略

- CLI：仅在有 `installCommand` 时自动执行
- resource：仅在有 `template` 或 `templateUrl` 时自动生成
- token/env：只给 manual next step
- `requires.skills`：只提示手动安装或注册依赖 skill，并默认沿用当前 host 语义

因此 `fix` 更适合处理显式声明了自动修复方式的问题。

从职责上看，`fix` 仍属于 Invoker control plane 的修复入口；它会改动 host 上可安全自动修复的部分，但不会把 registry 当成真实环境去修。
