# MVP Scope

## 目标

让一个已存在的 skill 从“在 host 上不可用”变成“在 host 上可用”。

## 本轮包含

- Invoker 作为 control plane 管理 host 上的 skill 可用性
- 推荐在 `skill.yaml` 中使用 `requires`
- 支持 `invoker.skill.yaml` 作为 sidecar 补充描述文件
- 扫描后生成统一的 normalized 依赖视图
- `doctor` 明确区分：
  - 缺依赖
  - 未配置
  - 未认证
- `install --dry-run` 展示自动/手动步骤
- `fix` 只自动处理显式可修复项
- `run` 在阻断时给出更准确的下一步建议
- `registry` 记录最近状态摘要
- 文档与用户可见术语统一收口为 host，强调宿主侧管理语义

## 本轮不包含

- skill-to-skill 递归依赖解析
- 远程 token 有效性校验
- 完整 normalized 结果持久化缓存
- 大规模插件式 checker 重构
- publish / registry 远程分发体系
- host 之间的自动双向分发与同步
- 自动下载远程 skill 包
