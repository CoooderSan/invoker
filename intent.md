# Invoker 设计大纲

Invoker 是一个面向 AI Skills 的 control plane，用来管理 skill 在宿主（host）上的依赖、配置、认证与可运行性。它解决的问题不是“有没有安装 skill”，而是：**skill 已存在后，是否真的能在当前 host 上运行。**

## 当前产品定义

Invoker 的最小卖点是：

- 发现 skill 在 host 上的运行依赖
- 检查当前 host 是否缺依赖、未配置、未认证
- 给出自动/手动修复路径
- 作为 control plane，在 skill 运行前做宿主侧可用性 gate

也就是说，Invoker 关注的是：

1. 缺依赖（missing dependency）
2. 未配置（unconfigured）
3. 未认证（unauthenticated）

## 现实约束

很多 skills 的原始 schema 目前没有完整声明 `requires`，因此 Invoker 需要同时支持两条路：

1. **标准主声明**：推荐在 `skill.yaml` 中直接增加 `requires`
2. **Invoker 兼容层**：当标准暂时不能改时，使用 `invoker.skill.yaml` 作为 sidecar 补充描述文件

最终，Invoker 会把两者合并为统一的 `effectiveRequires`，供 `doctor/install/fix/run` 使用。

## Invoker 的核心能力

### 1. scan — 依赖扫描

读取：
- `skill.yaml`
- 可选的 `invoker.skill.yaml`

输出：
- manifest 路径
- sidecar 路径
- 合并后的 `effectiveRequires`
- 每项依赖的来源（manifest / sidecar / merged）
- host
- 解析来源（direct path / cwd / host root）

### 2. doctor — 宿主侧可用性检查

检查当前 host 是否满足 skill 运行条件，并把问题归类为：
- 缺依赖
- 未配置
- 未认证

当前支持的依赖维度：
- CLI
- token
- env
- resource
- skills
- permissions（声明层预留）

输出：
- `DoctorReport`
- overall 状态（OK / Warning / Error）
- summary 摘要

### 3. install — 环境就绪计划

根据 doctor 报告生成计划：
- 哪些步骤可自动执行
- 哪些步骤需要手动处理

支持：
- `install --dry-run`
- `install`

### 4. fix — 自动修复

只处理显式可修复的问题：
- CLI：存在 `installCommand`
- resource：存在 `template` 或 `templateUrl`

不会自动处理：
- token 写入
- env 注入到用户全局 shell

### 5. run — 运行前 gate

`run` 在真正执行 skill 之前，会先做 doctor：
- blocking error => 阻断并给出下一步建议
- warning => 提示后继续

### 6. list / info / registry — 宿主侧状态摘要

本地 registry 负责保存：
- skill 基本信息
- host
- manifestPath
- sidecarPath
- 最近一次检查时间
- 最近一次状态摘要

registry **不是**完整声明缓存，只保存轻量摘要。

Invoker 作为 control plane，重点维护 host 上的可用性视图，而不是替代 skill 包本身的分发与托管。

## 推荐的声明方式

### 优先推荐：skill.yaml 中声明 requires

```yaml
name: review-skill
version: 1.0.0
entrypoint: ./run.sh

requires:
  cli:
    - name: gh
      command: gh
      installCommand: "brew install gh"

  tokens:
    - name: GitHub Token
      envVar: GITHUB_TOKEN
      required: true
```

### 兼容方案：invoker.skill.yaml

当上游 schema 无法及时支持时：

```yaml
schemaVersion: "0.1"
requires:
  cli:
    - name: jq
      command: jq
      installCommand: "brew install jq"
```

## 合并策略

- 身份字段：以 `skill.yaml` 为准
- 依赖字段：允许 sidecar 补充或覆盖运行细节
- 合并结果：形成 `effectiveRequires`

具体规则：
- `cli`：按 `name`
- `tokens`：按 `envVar`，退化按 `name`
- `env`：按 `envVar`
- `resources`：按 `path`，退化按 `name`
- `permissions`：并集去重

## 当前 MVP 范围

包含：
- `requires` 推荐与支持
- sidecar 支持
- normalized 依赖视图
- doctor/install/fix/run 链路升级
- docs/ 文档沉淀
- control plane 到 host 的宿主侧管理表述统一
- host-aware 的 scan/doctor/install/fix/run/registry

不包含：
- skill-to-skill 递归依赖求解
- 远程 token 有效性校验
- registry/publish 远程生态
- 完整 normalized 快照持久化
- host 之间的自动双向分发与同步
- 自动下载远程 skill 包

## 当前目录结构

```text
src/
  bin/
  core/
  utils/
  types.ts
examples/
  codeup-pr-review/
docs/
  architecture/
  manifest/
  commands/
  guides/
  examples/
```

## 长期方向

长期来看，Invoker 仍然可以继续演进成：
- 技能依赖管理器
- 技能环境修复器
- 技能运行时网关
- AI 可调用的 bridge skill

但当前阶段，优先把“已存在于 host 的 skill 变成可运行 skill”这件事做扎实。
