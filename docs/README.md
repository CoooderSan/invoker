# Invoker Docs

Invoker 解决的是：**skill 已安装，但因缺依赖、未配置、未认证而不可用**。

推荐的用户入口是：先在目标 host 安装 skill，再由 wrapper skill 或 AI 调用 `invoker bootstrap <skill>` 完成 Invoker bootstrap 与 readiness remediation。

## 阅读路径

### 对 skill 作者
- `manifest/skill-manifest.md` — 推荐用 `SKILL.md` frontmatter 声明 skill 元数据与 `requires`
- `manifest/invoker-sidecar.md` — 当需要兼容 legacy 输入或补充宿主私有信息时，如何使用 `invoker.skill.yaml`
- `guides/authoring-skills.md` — 如何让 skill 更容易被 Invoker 管理

### 对 skill 使用者
- `commands/scan.md` — 看 host 上最终生效的依赖声明
- `commands/info.md` — 一次性看 skill 元数据、registry 摘要与 doctor report
- `commands/doctor.md` — 看当前 host 缺什么，以及 machine-readable readiness report
- `commands/install.md` — 看自动/手动就绪计划
- `commands/fix.md` — 自动修复可修复问题
- `commands/run.md` — 运行 skill 前如何被 gate
- `guides/making-skills-runnable.md` — 从“已安装”到“可运行”的建议流程
- `guides/configuring-host-roots.md` — 如何配置和覆盖各个 host 的 skills 根目录
- `guides/troubleshooting.md` — 常见问题定位
- `README.md` — `register/unregister` 与 host 概念总览

`doctor` 的 readiness 语义现在覆盖：CLI、token、env、resource、依赖 skill，以及 host-aware 的 `settings` / `hostConfig` / `permissions`。

### 对维护者
- `mvp-scope.md` — 本轮范围边界
- `architecture/product-positioning.md` — 产品定位、边界与 readiness / trust 分层
- `architecture/execution-flow.md` — 主链路
- `architecture/data-model.md` — 主文档 / sidecar / normalized / report / registry 模型
- `manifest/merge-strategy.md` — 主文档与 sidecar 的合并规则
- `examples/codeup-pr-review.md` — 贯穿式示例
