# Merge Strategy

Invoker 会先解析主文档，再把主文档中的 `requires` 与 `invoker.skill.yaml.requires` 合并为 `effectiveRequires`。

## 顶层规则

- 主文档优先级：`SKILL.md` > `skill.yaml` / `skill.yml`
- skill 主体信息：始终以主文档为准
- 依赖细节：允许 sidecar 补充或覆盖
- 当 `SKILL.md` 与 legacy yaml 并存时，yaml 仅作为兼容输入存在，并会产生告警

## 分类合并规则

- `cli`：按 `name` 合并
- `tokens`：按 `envVar`，退化按 `name`
- `env`：按 `envVar`
- `resources`：按 `path`，退化按 `name`
- `permissions`：去重并集

## 来源标记

合并后每项依赖会保留来源：
- `manifest`
- `sidecar`
- `merged`

这样 `scan` 和 `doctor` 输出可以解释最终依赖从哪里来。
