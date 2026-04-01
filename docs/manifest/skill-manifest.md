# skill.yaml Manifest

Invoker 推荐在 skill 的主声明文件中直接加入 `requires`：

```yaml
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
```

## 为什么推荐把 requires 放在主声明里

- 依赖和 skill 本体放在一起，更容易维护
- `doctor/install/fix/run` 可以直接工作
- 更有利于未来推动生态标准化

## 当前现实

如果上游 schema 还不能稳定支持 `requires`，可以先用 `invoker.skill.yaml` 兜底。
