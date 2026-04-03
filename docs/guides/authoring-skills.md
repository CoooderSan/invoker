# Authoring Skills for Invoker

要让 skill 更容易被 Invoker 管理，推荐：

1. 用 `SKILL.md` frontmatter 声明 `name`、`description`、`version`、`entrypoint` 与 `requires`
2. 为 CLI 提供：
   - `versionCommand`
   - `minVersion`
   - `installHint`
   - `installCommand`
3. 为 token 和 env 提供明确的 `envVar`
4. 为 resources 提供 `path`，必要时提供 `template`
5. 如果依赖其它 skill，用 `requires.skills` 显式声明 `name`，必要时补 `path`
6. 只有在需要兼容 legacy 输入或补充宿主私有信息时，再使用 `invoker.skill.yaml`
7. 如果仓库里同时保留 `SKILL.md` 与 `skill.yaml`，Invoker 会以 `SKILL.md` 为准，并给出兼容告警

这样 `scan/doctor/install/fix/run` 就能形成闭环。

如果你的 skill 预期运行在特定 host 上，`requires.skills` 最好显式写清 `name`，必要时补 `path`，这样 Invoker 的 control plane 才能稳定定位和管理它。
