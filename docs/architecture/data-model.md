# Data Model

## 1. Manifest

`skill.yaml` 是 skill 的主声明文件，负责：
- `name`
- `description`
- `version`
- `entrypoint`
- `intents`
- 推荐的 `requires`

## 2. Sidecar

`invoker.skill.yaml` 是 Invoker 自己的补充描述文件，负责：
- 在上游 schema 缺少 `requires` 时补足依赖信息
- 为已有依赖补充安装/配置细节
- 提供 notes 或额外说明

## 3. NormalizedSkill

扫描后，Invoker 会得到统一视图：
- `manifest`
- `sidecar?`
- `effectiveRequires`
- `manifestPath`
- `sidecarPath?`
- `dir`

后续 `doctor/install/fix/run` 都基于这个统一视图工作。

## 4. DoctorReport

`doctor` 输出的是当前 host 状态，不是声明本身。核心包括：
- `overall`
- `summary`
- `checks[]`
- `requirementsDeclared`
- `manifestPath`
- `sidecarPath?`

## 5. Registry Summary

registry 是 Invoker control plane 持有的本地摘要索引，不是 host 上 skill 文件本身。

它只记录轻量摘要，例如：
- `status`
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
- 代替 host 上的真实 skill 目录
