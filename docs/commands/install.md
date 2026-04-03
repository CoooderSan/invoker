# invoker install

`install` 负责把 doctor 的结果转成 host 环境就绪计划。

## dry-run

推荐先运行：

```bash
invoker install --dry-run <skill>
```

这样可以先看到：
- 哪些步骤可自动执行
- 哪些步骤需要手动处理
- 每一步的 next step
- 缺失的依赖 skill 应该在哪个 host 下补齐

## 自动化边界

本轮 MVP 中：
- CLI 缺失：可自动安装（前提是显式提供 `installCommand`）
- token/env：默认只提示，不自动写用户 shell 配置
- resource：只有显式模板存在时才可自动物化
- `requires.skills`：优先消费 `doctor` 输出的 `remediationActions`，对可定位的本地依赖 skill 可自动生成 register 步骤；不做自动安装或版本求解
- `settings` / `hostConfig` / `permissions`：当前只作为 readiness diagnosis 的输入，不做自动修改宿主配置或授权

Invoker 在这里扮演 control plane：负责生成步骤、执行显式允许的修复动作，并把结果回写到摘要视图；真正被安装或配置的是 host 上的运行环境。
