# invoker.skill.yaml Sidecar

`invoker.skill.yaml` 是 Invoker 私有的补充描述文件，用来解决：

- 原始 skill schema 没有 `requires`
- 原始声明不完整
- 需要补充运行时安装/配置细节

## 文件名

推荐：`invoker.skill.yaml`

同目录放在 `SKILL.md` 或 `skill.yaml` 旁边。

## 典型示例

```yaml
schemaVersion: "0.1"
notes:
  - "补充原始 skill 未声明的依赖"

requires:
  cli:
    - name: jq
      command: jq
      installCommand: "brew install jq"

  resources:
    - name: review-template
      path: ./templates/review.md
      template: |
        # Review

  skills:
    - name: governance-init
      required: false
```

## 约束

sidecar 只负责补充运行信息，不应该覆盖这些主体字段：
- `name`
- `description`
- `version`
- `entrypoint`
- `intents`

这些字段仍以主文档（优先 `SKILL.md`，回退 `skill.yaml`）为准。
