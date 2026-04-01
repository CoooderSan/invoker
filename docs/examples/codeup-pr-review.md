# Example: codeup-pr-review

本示例演示 manifest + sidecar 的组合，以及完整的 scan → doctor → fix → register → run 链路，其中 host 是 skill 的实际运行环境，Invoker 只负责 control plane。

## 文件

- `examples/codeup-pr-review/skill.yaml` — 主体声明（git、curl、token、env、intents）
- `examples/codeup-pr-review/invoker.skill.yaml` — sidecar 补充（jq、review-template 资源）
- `examples/codeup-pr-review/review.sh` — 入口脚本

## 设计意图

- `skill.yaml` 保留 skill 的主体信息和部分 requires
- `invoker.skill.yaml` 补充：
  - `jq` CLI 依赖（来源标注为 `sidecar`）
  - `review-template` 资源模板（可被 `fix` 自动生成）

## 验证流程

### 1. 查看合并后的依赖声明

```bash
node dist/bin/invoker.js scan ./examples/codeup-pr-review
```

预期输出：
- Sidecar 路径已列出
- CLI 列表含 git、curl（manifest）和 jq（sidecar）
- Tokens / Env / Resources 各一条
- 会显示当前解析到的 host 信息

### 2. 检查当前环境

```bash
node dist/bin/invoker.js doctor ./examples/codeup-pr-review
```

预期输出：
- git / curl / jq → ✔（本机已安装）
- CODEUP_TOKEN → ✖ error（未设置）
- CODEUP_API_URL → ✖ error（未设置）
- review-template → ✖ error，fixable

### 3. 预览就绪计划

```bash
node dist/bin/invoker.js install --dry-run ./examples/codeup-pr-review
```

预期输出：
- token / env → manual
- review-template → auto

### 4. 自动修复可修复项

```bash
node dist/bin/invoker.js fix ./examples/codeup-pr-review
```

预期输出：
- review-template 被创建（`templates/review.md`）
- token / env 跳过，输出手动提示

### 5. 查看详情

```bash
node dist/bin/invoker.js info ./examples/codeup-pr-review
```

预期输出：所有依赖计数、intents、host 信息、以及最新 doctor 报告。

### 6. 注册到本地 control plane registry

```bash
node dist/bin/invoker.js register ./examples/codeup-pr-review
node dist/bin/invoker.js list
node dist/bin/invoker.js list --refresh
```

预期输出：
- register → 成功写入 Invoker 的本地摘要索引
- list → 显示该 skill（状态为 "registered, not yet checked"）
- list --refresh → 重新扫描 host 后，状态更新为实际 doctor 结果

### 7. 注销

```bash
node dist/bin/invoker.js unregister codeup-pr-review
```

注意：
- `unregister` 只移除 registry 记录
- 不会删除宿主上的 skill 文件
- 因此 refresh 后仍可能再次被发现

## 注意

- `templates/review.md` 是由 `fix` 生成的本地文件，已加入 `.gitignore`，不会进入版本控制
- 设置 `CODEUP_TOKEN` 和 `CODEUP_API_URL` 后，`doctor` 将全部通过，可正常 `run`
- `register` / `unregister` 影响的是 Invoker control plane 中的记录，不会替代 host 上真实 skill 目录
