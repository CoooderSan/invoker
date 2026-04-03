# Execution Flow

Invoker 继续沿用现有主链路：

1. `scan`
   - 优先读取 `SKILL.md` frontmatter
   - 在没有 `SKILL.md` 时兼容读取 `skill.yaml` / `skill.yml`
   - 查找可选的 `invoker.skill.yaml`
   - 合并得到 `effectiveRequires`
   - 识别当前 skill 所属 host
2. `doctor`
   - 基于 `effectiveRequires` 检查当前 host 是否已满足运行条件
3. `install`
   - 将 doctor 结果转成 host 就绪计划
4. `fix`
   - 对显式可修复项做自动修复，然后重跑 doctor
5. `run`
   - 在 doctor 通过或仅 warning 时运行 skill
6. `register` / `unregister`
   - 由 Invoker control plane 记录或移除本地摘要索引项
7. `registry`
   - 保存最近一次观察到的 host 上 skill 状态摘要

## 设计原则

- 不推翻现有实现
- sidecar 只补充运行信息，不重写 skill 身份信息
- Invoker 是 control plane，host 才是 skill 的实际运行落点
- registry 只存摘要，不存完整快照
