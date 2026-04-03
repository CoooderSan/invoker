# Primary Skill Document

Invoker 推荐用 `SKILL.md` frontmatter 作为 skill 的主声明文件：

```md
---
name: my-skill
description: Example skill
version: 1.0.0
entrypoint: ./main.sh

requires:
  cli:
    - name: gh
      command: gh
      versionCommand: "gh --version"
      minVersion: "2.0.0"
      installHint: "Install gh via Homebrew"
      installCommand: "brew install gh"

  tokens:
    - name: GitHub Token
      envVar: GITHUB_TOKEN
      required: true

  env:
    - name: API URL
      envVar: API_URL
      required: true

  resources:
    - name: review-template
      path: ./templates/review.md
      template: |
        # Review

  skills:
    - name: governance-init
      required: false

  settings:
    - key: enableAllProjectMcpServers
      host: claude
      required: true

  hostConfig:
    - name: claude-root
      host: claude
      kind: root_exists
      required: true

  permissions:
    - mcp__codeup__list_merge_requests
---

# My Skill
```

## 为什么推荐把 requires 放在主文档里

- 元数据、依赖与说明放在同一个文件中，更容易维护
- `doctor/install/fix/run` 可以直接工作
- 更有利于未来推动单文件模型成为生态默认

## 兼容期输入

如果暂时还没迁移到 `SKILL.md`，Invoker 仍兼容读取 `skill.yaml` / `skill.yml`。
如果还需要补宿主私有信息，可以继续用 `invoker.skill.yaml` 兜底。
