# invoker info

`info` 用于一次性查看某个 skill 的：
- manifest 元数据
- merge 后的 `effectiveRequires`
- 当前解析出的 host / root / 目录位置
- registry 中最近一次摘要
- 最新 `doctor` 结果

如果说：
- `scan` 更偏“声明视角”
- `doctor` 更偏“readiness 视角”

那么 `info` 就是把两者合并后的综合视图。

## `--json` schema

`info --json` 的顶层字段包括：
- `manifest`
- `effectiveRequires`
- `dir`
- `manifestPath`
- `sidecarPath`
- `primaryDocPath`
- `primaryDocFormat`
- `warnings`
- `target`
- `targetRoot`
- `registered`
- `registryEntry`
- `doctorReport`

### `registryEntry`
`registryEntry` 表达的是 Invoker control plane 最近一次保存的轻量摘要，而不是当前实时检查本身。

当前典型字段包括：
- `name`
- `version`
- `path`
- `status`
- `readinessStatus`
- `trustStatus`
- `overallStatus`
- `blockingCount`
- `manifestPath`
- `sidecarPath`
- `primaryDocPath`
- `primaryDocFormat`
- `warnings`
- `lastScannedAt`
- `lastDoctorAt`
- `lastStatusSummary`

### `doctorReport`
`doctorReport` 与 `invoker doctor --json` 返回的结构一致。

其中建议优先消费：
- `readinessStatus`
- `trustStatus`
- `overallStatus`
- `declaredProblems`
- `observedProblems`
- `dependencyFindings`
- `remediationActions`
- `trustReport`

因此：
- 如果只想拿 readiness / trust report，直接用 `doctor --json`
- 如果想同时拿 skill 元信息、host 定位、registry 摘要和 readiness / trust report，用 `info --json`

## 示例

```json
{
  "manifest": {
    "name": "codeup-pr-review",
    "description": "Review a Codeup PR",
    "version": "1.0.0",
    "entrypoint": "./run.sh"
  },
  "effectiveRequires": {
    "cli": [
      {
        "name": "gh",
        "command": "gh",
        "source": "manifest"
      }
    ],
    "skills": [
      {
        "name": "skills-check",
        "required": false,
        "source": "sidecar"
      }
    ]
  },
  "dir": "/host/skills/codeup-pr-review",
  "manifestPath": "/host/skills/codeup-pr-review/SKILL.md",
  "sidecarPath": "/host/skills/codeup-pr-review/invoker.skill.yaml",
  "primaryDocPath": "/host/skills/codeup-pr-review/SKILL.md",
  "primaryDocFormat": "markdown",
  "warnings": [
    {
      "code": "duplicate_primary_doc",
      "message": "SKILL.md takes precedence over legacy YAML files; YAML files are treated as compatibility-only side documents.",
      "paths": [
        "/host/skills/codeup-pr-review/SKILL.md",
        "/host/skills/codeup-pr-review/skill.yaml",
        "/host/skills/codeup-pr-review/invoker.skill.yaml"
      ]
    }
  ],
  "target": "claude",
  "targetRoot": "/Users/me/.claude/skills",
  "registered": true,
  "registryEntry": {
    "name": "codeup-pr-review",
    "version": "1.0.0",
    "path": "/host/skills/codeup-pr-review",
    "status": "error",
    "readinessStatus": "error",
    "trustStatus": "warning",
    "overallStatus": "error",
    "blockingCount": 2,
    "lastStatusSummary": "2 errors"
  },
  "doctorReport": {
    "skillName": "codeup-pr-review",
    "readinessStatus": "error",
    "trustStatus": "warning",
    "overallStatus": "error",
    "declaredProblems": [],
    "observedProblems": [],
    "dependencyFindings": [],
    "remediationActions": [],
    "trustReport": {
      "status": "warning",
      "findings": [
        {
          "provider": "skills-check",
          "message": "Potential issue detected"
        }
      ]
    }
  }
}
```

## 什么时候优先用 `info`

适合这几类场景：
- 想确认当前 skill 是从哪个 host root 被解析出来的
- 想同时拿 `effectiveRequires` 和 readiness 结果
- 想比较“registry 最近摘要”和“本次 doctor 实时结果”
- 上层 AI 需要把 skill 元数据与 readiness 一并纳入决策
