# Configuring Host Roots

Invoker 默认会按内置约定去找各个 host 的 skills 目录：

- `invoker` → `~/.invoker/skills`
- `claude` → `~/.claude/skills`
- `codex` → `~/.codex/skills`

当你的本地布局不是这些默认路径时，可以通过两种方式覆盖。

## 1. 临时覆盖：`--host-root`

适合：
- 临时验证
- 调试
- 测试场景
- 不想改持久配置时

例如：

```bash
invoker scan my-skill --host claude --host-root /custom/claude/skills
invoker list --host codex --host-root /custom/codex/skills
```

`--host-root` 只对当前这次命令生效。

## 2. 持久配置：`invoker hosts`

适合：
- 日常使用
- 固定的本机目录布局
- 不想每次都手写 `--host-root`

### 查看当前生效 roots

```bash
invoker hosts list
```

输出会展示：
- 默认 root
- 当前生效 root
- 是否来自自定义配置
- 该目录当前是否存在

### 设置某个 host 的 root

```bash
invoker hosts set claude /custom/claude/skills
invoker hosts set codex /custom/codex/skills
```

这会把配置写入：

```text
~/.invoker/config.json
```

### 删除某个 host 的自定义 root

```bash
invoker hosts unset claude
```

删除后会回退到默认路径。

## 优先级规则

Invoker 对 host root 的解析优先级固定为：

1. 命令行传入的 `--host-root`
2. `~/.invoker/config.json` 中的持久配置
3. 内置默认路径

也就是说：
- 持久配置适合日常使用
- `--host-root` 适合临时覆盖，并且总是最高优先级

## 一个典型例子

如果你的 Claude skills 不在默认位置，而是在：

```text
/Users/me/workspace/claude-skills
```

可以先持久化配置：

```bash
invoker hosts set claude /Users/me/workspace/claude-skills
```

之后就可以直接：

```bash
invoker scan my-skill --host claude
invoker doctor my-skill --host claude
invoker list --host claude
```

只有当你想临时切到另一套目录时，再显式传：

```bash
invoker scan my-skill --host claude --host-root /tmp/test-claude-skills
```

## 注意

- `hosts set` 不要求目标路径必须已经存在，但命令会提示该路径当前是否存在。
- `hosts unset` 只移除 Invoker 的持久配置，不会删除任何 host 上的目录或 skill 文件。
- host roots 只影响“去哪里发现和解析 skill”，不会改变 skill 本身的内容。
