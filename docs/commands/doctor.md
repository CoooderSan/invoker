# invoker doctor

`doctor` 用于检查当前 host 是否已满足 skill 的运行条件。

Invoker 会把问题表达为三类：
- 缺依赖：例如 CLI 未安装或版本不满足
- 未配置：例如 env/resource 缺失
- 未认证：例如 token 未设置

另外，`doctor` 也会检查 `requires.skills` 中声明的依赖 skill 是否可用：
- 必需依赖缺失：`error`
- 可选依赖缺失：`warning`
- 默认沿用父 skill 的同一 host 语义进行解析

同时，`doctor` 还支持 host-aware readiness 检查：
- `settings`：检查 Claude / Codex / Invoker 的宿主设置项是否存在、是否满足期望值
- `hostConfig`：检查宿主 root 是否已配置、是否存在
- `permissions`：当前先记录为声明存在但未可验证的权限需求，统一进入 `warning`

输出包括：
- manifest/sidecar 路径
- 每项检查结果
- overall 状态
- 简洁摘要
- `declaredProblems`：声明层可直接归因的问题
- `observedProblems`：运行期派生或低置信度问题
- `dependencyFindings`：`requires.skills` 的单独发现结果
- `remediationActions`：结构化下一步动作，供 `install` 或 AI 宿主消费
- `trustReport`：由外部 trust checker 映射后的统一结果（含 providers 与 findings）

当前 `doctor --json` 会同时保留旧字段（`overall/summary/checks`）和新的 readiness plane 字段，方便渐进迁移。

`doctor` 的判断对象始终是 host 上当前这份 skill，而不是 registry 里的静态记录。registry 只保存最近一次观察摘要。

## `--json` schema

`doctor --json` 的顶层字段可以分成两层理解：

### 兼容层（旧字段，继续保留）
- `overall`
- `summary`
- `checks`

这层适合已有调用方继续工作。

### Readiness plane（新字段，推荐优先消费）
- `skillName`
- `manifestPath`
- `sidecarPath`
- `timestamp`
- `readinessStatus`
- `trustStatus`
- `overallStatus`
- `declaredProblems`
- `observedProblems`
- `dependencyFindings`
- `remediationActions`
- `readinessReport`
- `trustReport`

### 状态枚举
- `readinessStatus` / `overall` / `checks[].status`：`ok | warning | error`
- `trustStatus`：`ok | warning | error | unknown`
  - 无 checker：`unknown`
  - checker 执行失败或输出非法 JSON：通常退化为 `warning`
- `overallStatus`：综合 readiness 与 trust 的聚合状态
  - `overall` 继续保持 readiness 兼容语义
  - 如果 trust 有风险（warning/error），`overallStatus` 反映综合结果

## 字段语义

### `declaredProblems[]`
只包含非 `ok` 问题，并且这些问题可以直接归因到：
- `skill.yaml`
- `invoker.skill.yaml`
- 二者 merge 后的声明

典型例子：
- manifest 声明了缺失的 CLI
- sidecar 声明了缺失的 resource
- merge 后得到的 env/token 依赖未满足

### `observedProblems[]`
只包含非 `ok` 问题，且来源是运行期派生判断，通常 `source: "derived"`。

典型例子：
- skill 没有声明 `requires`，所以 Invoker 只能做有限校验

### `dependencyFindings[]`
专门表达 `requires.skills` 的结果，避免与普通 CLI/env/token 检查混淆。

它会保留：
- 依赖名
- 当前状态（`ok | warning | error`）
- 是否必需（`required`）
- 建议的 host / path
- remediation

注意：这里既包含失败依赖，也包含成功依赖，因为上层 AI 往往需要完整依赖图上的“已满足 / 未满足”结果。

### `remediationActions[]`
把下一步动作标准化，供：
- `invoker install`
- AI 宿主
- 上层 skill

优先消费。

动作类型当前包括：
- `install`
- `configure`
- `create`
- `register`
- `verify`

每项 action 至少会包含：
- `type`
- `category`
- `name`
- `mode`（`auto | manual`）
- `description`
- `remediation`

可自动执行时还可能包含：
- `command`
- `target`
- `targetRoot`
- `path`

## Trust checker 输入与输出约定

当 sidecar 配置了 `trust.checkers[]` 后，Invoker 会把 checker 当作 skill 执行，并传入：
- 第一个位置参数：被检查 skill 的目录
- 环境变量：
  - `INVOKER_TRUST_SUBJECT`
  - `INVOKER_TRUST_SUBJECT_NAME`
  - `INVOKER_TRUST_SUBJECT_MANIFEST`
  - `INVOKER_TRUST_SUBJECT_SIDECAR`
  - `INVOKER_TRUST_SUBJECT_TARGET`

checker 需要输出 JSON，最小格式：

```json
{
  "findings": [
    {
      "name": "unsafe-pattern",
      "status": "warning",
      "ruleId": "SC001",
      "message": "Potential issue detected",
      "remediation": "Optional remediation text"
    }
  ]
}
```

其中：
- `status: "error"` 会映射为 trust error finding
- 其它状态会映射为 trust warning finding

## 示例

```json
{
  "skillName": "codeup-pr-review",
  "manifestPath": "/host/skills/codeup-pr-review/skill.yaml",
  "sidecarPath": "/host/skills/codeup-pr-review/invoker.skill.yaml",
  "timestamp": "2026-04-02T12:34:56.000Z",
  "overall": "error",
  "readinessStatus": "error",
  "trustStatus": "warning",
  "overallStatus": "error",
  "summary": {
    "total": 4,
    "ok": 1,
    "warning": 1,
    "error": 2,
    "blocking": 2
  },
  "declaredProblems": [
    {
      "name": "gh",
      "category": "cli",
      "status": "error",
      "source": "manifest",
      "origin": "declared",
      "message": "Missing dependency: CLI \"gh\" is not installed",
      "remediation": "Run brew install gh"
    }
  ],
  "observedProblems": [],
  "dependencyFindings": [],
  "remediationActions": [
    {
      "type": "install",
      "category": "cli",
      "name": "gh",
      "status": "error",
      "mode": "auto",
      "description": "Install dependency: gh",
      "command": "brew install gh",
      "remediation": "Run brew install gh"
    }
  ],
  "readinessReport": {
    "status": "error",
    "summary": {
      "total": 4,
      "ok": 1,
      "warning": 1,
      "error": 2,
      "blocking": 2
    },
    "declaredProblems": [],
    "observedProblems": [],
    "dependencyFindings": [],
    "remediationActions": []
  },
  "trustReport": {
    "status": "warning",
    "findings": [
      {
        "name": "unsafe-pattern",
        "category": "manifest",
        "status": "warning",
        "provider": "skills-check",
        "ruleId": "SC001",
        "message": "Potential issue detected",
        "origin": "observed"
      }
    ],
    "providers": [
      {
        "name": "skills-check",
        "status": "warning",
        "executed": true
      }
    ],
    "summary": {
      "total": 1,
      "warning": 1,
      "error": 0
    }
  },
  "checks": []
}
```

上层 AI 如果只关心“当前能不能跑”，优先读取：
- `readinessStatus`
- `trustStatus`
- `overallStatus`
- `dependencyFindings`
- `remediationActions`

如果要兼容旧调用方，再回退到：
- `overall`
- `summary`
- `checks`
