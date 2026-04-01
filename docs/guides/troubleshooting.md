# Troubleshooting

## 1. skill 已安装，但 run 失败
先执行：

```bash
invoker doctor <skill>
```

看是：
- 缺依赖
- 未配置
- 未认证

如果这个 skill 来自特定 host，也建议显式带上：

```bash
invoker doctor <skill> --host claude
```

## 2. sidecar 没生效
执行：

```bash
invoker scan <skill>
```

确认输出里是否显示：
- `Sidecar:` 路径
- 依赖项带 `[sidecar]` 或 `[merged]`
- 当前 host / host root 是否符合预期

## 3. resource 没自动生成
检查：
- 是否声明了 `template`
- 是否声明了 `templateUrl`

如果两者都没有，Invoker 只会提示手动创建。

## 4. list 没看到最近状态
执行：

```bash
invoker list --refresh
```

registry 只存摘要，刷新后才会更新最近状态。真正的可用性判断仍来自 host 上当前 skill 的重新扫描与检查。

## 5. register / unregister 后结果和预期不一致
先确认：

```bash
invoker scan <skill>
invoker info <skill>
```

需要注意：
- `register` / `unregister` 改变的是 Invoker control plane 中的摘要索引
- skill 是否真的可运行，仍取决于 host 上对应目录、依赖和配置是否满足
- 如果 host 上文件已变化但 registry 还没刷新，优先执行 `list --refresh` 或重新 `doctor`
