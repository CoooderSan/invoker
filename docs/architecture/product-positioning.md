# Product Positioning

## 核心定义

Invoker 的定位应收敛为：

**面向 AI 宿主的 skill readiness inspector / control plane。**

它不解决 skill 的市场分发问题，也不试图成为 AI 时代的 npm / maven。

Invoker 解决的问题是：

- 宿主上当前有哪些 skills
- 每个 skill 当前是否 ready
- 如果不 ready，阻塞原因是什么
- 哪些问题来自声明，哪些问题来自探测
- 哪些问题是可运行性问题，哪些问题是可信度问题

## 为什么不做 package manager

当前 skill 分发已经越来越依赖各类 AI 工具自己的 marketplace，生态也天然更去中心化。

因此 Invoker 不应承担：

- 远程分发
- 中央 registry 托管
- 包下载与安装
- 版本求解与锁定
- 类似 npm / maven 的 dependency solver

这些不是当前产品的核心价值。

Invoker 的价值在于宿主侧治理：

- inventory
- readiness diagnosis
- status reporting
- control-plane style visibility

## 主要使用方式

Invoker 面向的不是终端用户，而是 AI 工具与 AI skills。

典型链路：

1. 宿主 AI 或上层 skill 调用 Invoker
2. Invoker 扫描宿主目录中的 skills
3. Invoker 判断每个 skill 的 readiness / trust 状态
4. Invoker 返回结构化报告
5. 上层 AI 基于报告决定如何向用户解释、引导或补齐

因此，Invoker 的第一优先级不是 CLI 交互体验，而是：

- AI 可准确理解
- 输出稳定
- 语义可组合
- 报告适合作为自动化决策输入

## 核心能力边界

### 1. Readiness Plane

Readiness 回答的是：

**这个 skill 在当前 host 上现在能不能运行。**

这类问题包括：

- 缺少 CLI
- 缺少其他 skills
- 缺少 env
- 缺少 token
- 缺少 resource
- 缺少 host settings
- 缺少权限声明或宿主授权

### 2. Trust Plane

Trust 回答的是：

**这个 skill 本身是否可信、是否安全、是否值得宿主继续放行。**

这类问题包括：

- 来源是否可信
- 内容是否存在明显风险
- 是否命中安全策略
- 是否过期、失效、长期无人维护
- 是否通过外部质量或安全检查

Trust 不等于 readiness。

一个 skill 可能：

- ready 但不 trusted
- trusted 但 not ready

因此报告中必须分开表达。

## 声明式优先，探测式兜底

### 声明式诊断

Invoker 的主机制应是声明式诊断。

输入来源：

- `SKILL.md`
- `skill.yaml` / `skill.yml`（兼容输入）
- `invoker.skill.yaml`

声明式诊断的优点：

- 稳定
- 可批量处理
- 可解释
- 适合 AI 理解
- 适合递归分析

### 探测式诊断

当 skill 没有完整声明时，可以增加探测式诊断作为 fallback：

- 尝试调用 skill 的安全入口
- 捕获退出码、stdout、stderr
- 从运行结果中提取缺失依赖或配置线索

但探测式诊断只能作为补充，不能替代声明式诊断。

原因：

- 运行可能有副作用
- 报错不稳定
- 报错不一定是真正根因
- 不同作者输出格式差异大

因此探测结果必须明确标记为：

- `observed`
- `derived`
- 非高置信度

而不是当作声明事实。

## 为什么要支持递归

如果 skills 数量持续增长，单点检查会很快不够用。

未来需要支持：

- skill A 依赖 skill B
- skill B 自己又缺少 CLI / token / env
- 宿主 AI 需要拿到依赖树上的阻塞汇总

因此递归 readiness 是合理方向。

建议区分两类输出：

- 当前 skill 的直接问题
- 依赖树传递上来的阻塞问题

避免把所有问题扁平化后丢失归因。

## 对外报告原则

Invoker 输出应优先服务 AI 消费，而不是人类阅读。

因此报告应具备：

- 稳定 schema
- 稳定枚举值
- 明确问题来源
- 明确阻塞等级
- 明确建议动作

推荐至少区分：

- `readinessStatus`
- `trustStatus`
- `declaredProblems`
- `observedProblems`
- `dependencyFindings`
- `remediationActions`

## 宿主设置应显式入模

仅靠 `env` / `token` 不足以覆盖真实问题。

很多 skill 的问题来自 host 自身配置，例如：

- Claude/Codex 的 settings key 未配置
- 宿主能力开关未开启
- 宿主授权未授予

因此后续 schema 建议增加类似维度：

- `settings`
- `hostConfig`
- `permissions`

否则 Invoker 无法稳定回答“为什么这个 skill 没 ready”。

## 与外部 trust checker 的关系

Invoker 可以接入外部 trust / security checker，例如：

- `skills-check`
- `SkillCheck`
- `SkillScan`

但接入方式应是 adapter，而不是直接把外部自然语言结果原样透传。

推荐做法：

- Invoker 维护自己的统一 report schema
- 外部工具结果映射成统一结构
- 在报告中保留来源，例如 `source: skills-check`

这样宿主 AI 才能稳定消费多个 checker 的结果。

更具体地说，Invoker 可以同时产出两份子报告：

- readiness report
- trust / security report

其中：

- readiness report 主要来自 Invoker 自身的声明式检查与探测式检查
- trust / security report 主要来自外部 checker 与 Invoker 自身的基础策略判断

然后再把两份子报告汇总成一份完整报告，供宿主 AI 消费。

推荐结构是：

- 一个统一的顶层 report
- report 内部分开保存 `readinessReport` 与 `trustReport`
- 再补一个聚合后的 `overallStatus` / `overallFindings` / `recommendedActions`

这样可以同时保证：

- readiness 与 trust 语义不混淆
- 上层 AI 可以分别理解两个维度
- 也可以直接消费最终聚合结论

不建议把外部 checker 的输出直接拼接成自然语言段落。

更稳妥的方式是：

- 先标准化
- 再归类
- 再聚合

最终形成一份完整的 machine-readable report。

## 当前产品叙事建议

建议避免继续使用：

- `AI Skill Package Manager`
- `AI 时代的 npm / maven`

建议改为：

- `AI Skill Readiness Inspector`
- `AI Skill Host Doctor`
- `AI Skill Control Plane`

如果仍保留 Invoker 这个名字，也应让外部首先理解它是：

**一个帮助 AI 宿主管理 skill inventory、状态与可运行性的控制层。**
