# Invoker — AI Skill Package Manager

Invoker 是一个面向 AI Skills 的 control plane，用来管理 skill 在宿主（host）上的依赖、配置、认证与可运行性。它解决的问题是：**skill 已存在，但因为宿主侧缺依赖、未配置、未认证而不可用**。

## 快速开始

```bash
# 安装依赖
npm install

# 编译
npm run build

# 使用
node dist/bin/invoker.js scan ./examples/codeup-pr-review
node dist/bin/invoker.js doctor ./examples/codeup-pr-review
node dist/bin/invoker.js install --dry-run ./examples/codeup-pr-review
node dist/bin/invoker.js fix ./examples/codeup-pr-review
node dist/bin/invoker.js info ./examples/codeup-pr-review
```

## 全局安装

```bash
npm install -g @cooodersan/invoker
invoker scan ./examples/codeup-pr-review
```

## 临时执行

```bash
npx @cooodersan/invoker scan ./examples/codeup-pr-review
```

## 核心定位

- Invoker 是面向 AI Skills 的 control plane
- host 是 skill 实际运行与被检查的宿主环境
- `scan/doctor/install/fix/run` 都围绕宿主侧可用性管理展开

## 核心命令

| 命令 | 说明 |
|------|------|
| `invoker scan <skill>` | 扫描 skill 的最终依赖声明（manifest + sidecar） |
| `invoker doctor <skill>` | 检查当前环境是否满足运行条件 |
| `invoker install <skill>` | 根据 doctor 结果执行自动化安装步骤 |
| `invoker install --dry-run <skill>` | 预览自动/手动依赖就绪计划 |
| `invoker fix <skill>` | 自动修复显式可修复问题 |
| `invoker list` | 列出当前 host 上已发现的 skills |
| `invoker info <skill>` | 显示 skill 详情与最近状态 |
| `invoker run <skill>` | 在 doctor gate 后运行 skill |
| `invoker register <skill>` | 把宿主上已存在的 skill 注册进 Invoker registry |
| `invoker unregister <skill>` | 从 Invoker registry 中移除 skill 记录，不删除宿主文件 |

大多数命令都支持：

- `--host <host>`：指定宿主环境，例如 `claude`、`codex`、`invoker`
- `--host-root <path>`：覆盖该 host 的 skills 根目录

另外也支持持久化 host roots 配置：

- `invoker hosts list`
- `invoker hosts set <host> <path>`
- `invoker hosts unset <host>`

## 推荐在 skill.yaml 中声明 requires

Invoker 推荐 skill 作者直接在 `skill.yaml` 中声明 `requires`：

```yaml
name: my-skill
description: My awesome skill
version: 1.0.0
entrypoint: ./main.js

requires:
  cli:
    - name: git
      command: git
      versionCommand: "git --version"
      minVersion: "2.30.0"
      installCommand: "brew install git"

  tokens:
    - name: API Token
      envVar: MY_API_TOKEN
      required: true

  env:
    - name: API URL
      envVar: MY_API_URL
      defaultValue: "https://api.example.com"

  resources:
    - name: config
      path: ./config.json
      template: '{"key": "value"}'
```

## 当上游 schema 暂时不支持时：使用 sidecar

Invoker 支持同目录下的 `invoker.skill.yaml` 作为补充描述文件，用来：

- 补充原始 skill 未声明的依赖
- 为已声明依赖补充运行细节
- 让 `scan/doctor/install/fix/run` 继续工作

合并后的依赖会被视为 `effectiveRequires`。

## 设计原则

- `skill.yaml` 是主体声明
- `invoker.skill.yaml` 是补充运行信息
- `scan` 输出最终生效的依赖视图
- `doctor` 把问题分成：缺依赖 / 未配置 / 未认证
- `registry` 只记录最近状态摘要，不保存完整快照
- Invoker 作为 control plane 管理 host 侧状态，不把 host 运行细节永久固化成中心化快照

## 文档

更多设计与使用说明见：

- `docs/README.md`
- `docs/mvp-scope.md`
- `docs/manifest/skill-manifest.md`
- `docs/manifest/invoker-sidecar.md`
- `docs/manifest/merge-strategy.md`
- `docs/guides/configuring-host-roots.md`
- `docs/examples/codeup-pr-review.md`

## 项目结构

```text
src/
  bin/invoker.ts       # CLI 入口
  core/
    scanner.ts         # 解析并合并 skill.yaml / invoker.skill.yaml
    doctor.ts          # 环境检查
    installer.ts       # 生成/执行依赖就绪计划
    fixer.ts           # 自动修复
    registry.ts        # 本地 Skill 注册表与状态摘要
    runner.ts          # 运行 Skill
  utils/
    logger.ts          # 日志输出
    exec.ts            # 命令执行
    fs.ts              # 文件操作
  types.ts             # 类型定义
examples/
  codeup-pr-review/    # manifest + sidecar 示例

docs/
  ...                  # 开发与使用文档
```

## License

MIT
