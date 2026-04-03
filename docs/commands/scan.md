# invoker scan

`scan` 用于查看 host 上某个 skill 的最终依赖声明。

它会：
- 优先读取 `SKILL.md`
- 在没有 `SKILL.md` 时兼容读取 `skill.yaml`
- 查找可选 `invoker.skill.yaml`
- 输出 merged 后的 `effectiveRequires`
- 显示每项依赖来源
- 显示当前 skill 是从哪个 host 被解析出来的
- 在使用 legacy yaml 或双文件并存时输出告警元信息

典型用途：
- 验证 `SKILL.md` frontmatter 是否生效
- 验证 sidecar 是否生效
- 确认某个 skill 在当前 host 上最终声明了哪些 CLI / token / env / resources
- 在 `register` 前先确认 Invoker 看到的是哪份主文档
