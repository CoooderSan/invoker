# Data Model

## 1. Primary Skill Document

`SKILL.md` 是 skill 的长期主声明文件，frontmatter 负责：
- `name`
- `description`
- `version`
- `entrypoint`
- `intents`
- 推荐的 `requires`
- 可选的 `trust`
- 可选的 `notes`

兼容期内，Invoker 仍接受 `skill.yaml` / `skill.yml` 作为 legacy 主文档输入，但会把它标记为兼容模式。

## 2. Sidecar

`invoker.skill.yaml` 是 Invoker 自己的补充描述文件，负责：
- 在 legacy 输入或宿主私有需求下补足依赖信息
- 为已有依赖补充安装/配置细节
- 在主文档未声明 trust 时补充 trust plane 的 checker 配置
- 提供 notes 或额外说明

## 3. NormalizedSkill

扫描后，Invoker 会得到统一视图：
- `manifest`
- `sidecar?`
- `effectiveRequires`
- `trust?`
- `manifestPath`
- `sidecarPath?`
- `primaryDocPath`
- `primaryDocFormat`
- `warnings[]`
- `dir`
- `target`
- `targetRoot?`
- `resolutionSource`

兼容约束：
- `manifestPath` / `sidecarPath` 继续保留，供现有 JSON 消费方使用
- `primaryDocPath` / `primaryDocFormat` 用于表达真实主文档来源
- `warnings[]` 用于表达 legacy yaml 或双文件并存告警

后续 `doctor/install/fix/run` 都基于这个统一视图工作。

## 4. DoctorReport

`doctor` 输出的是当前 host 状态，不是声明本身。当前保留兼容字段：
- `overall`
- `summary`
- `checks[]`
- `requirementsDeclared`
- `manifestPath`
- `sidecarPath?`

同时补充 readiness / trust plane 结构化字段：
- `readinessStatus`
- `trustStatus`
- `overallStatus`
- `declaredProblems[]`
- `observedProblems[]`
- `dependencyFindings[]`
- `remediationActions[]`
- `readinessReport`
- `trustReport?`

约束：
- `overall` 继续保持 readiness 兼容语义（用于 run gate）
- `overallStatus` 是 readiness + trust 的综合状态
- `declaredProblems` 用于表达可直接归因到主文档 / sidecar / merged 声明的问题
- `observedProblems` 用于表达运行时推导出的低置信度或派生问题（例如声明缺失导致只能有限验证）
- `dependencyFindings` 单独承载 `requires.skills` 结果，避免与一般检查混淆
- `remediationActions` 用于把可执行或可提示的下一步动作结构化，供 `install`、AI 宿主或上层 skill 消费

## 5. TrustReport

`trustReport` 是由外部 checker（当前优先支持 skill 形式 checker）映射后的统一结构：
- `status`: `ok | warning | error | unknown`
- `findings[]`: 统一 ProblemFinding 风格的 trust 发现
  - 常见字段：`provider`, `ruleId`, `message`, `remediation`
- `providers[]`: 每个 checker provider 的执行摘要
  - `name`, `status`, `executed`, `message`, `checkedAt`
- `summary`: `total`, `warning`, `error`

映射约定：
- 未配置 checker：`status = unknown`
- checker 输出非法 JSON：退化为 warning finding
- checker finding 含 `status=error`：映射为 trust error
- checker finding 其它状态：映射为 trust warning

## 6. Registry Summary

registry 是 Invoker control plane 持有的本地摘要索引，不是 host 上 skill 文件本身。

它只记录轻量摘要，例如：
- `status`
- `readinessStatus`
- `trustStatus`
- `overallStatus`
- `blockingCount`
- `manifestPath`
- `sidecarPath`
- `lastScannedAt`
- `lastDoctorAt`
- `lastStatusSummary`

它的职责是：
- 记录 Invoker 最近一次观察到的 host 上 skill 状态
- 为 `list` / `info` / 最近检查结果提供摘要视图
- 承载 `register` / `unregister` 这类 control plane 操作结果

它不负责：
- 作为 skill 的唯一事实来源
- 保存完整 normalized 快照
- 保存完整 readiness report
- 代替 host 上的真实 skill 目录
