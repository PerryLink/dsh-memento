# 让你的记忆插件说 dsh-memory-protocol

> English version: [adapters-guide.md](adapters-guide.md)。协议本体见
> [protocol-v1.zh.md](protocol-v1.zh.md)；适配器注册表服务是 `ctx.memoryAdapters`。

通往协议有两条路，按你的插件形态选：

| 你的插件是… | 路 | 你要实现什么 |
| --- | --- | --- |
| 自带 store 的 DSH 插件 | **Provider 一致性** | [`test/protocol-conformance/README.md`](../test/protocol-conformance/README.md) 的 Provider 面——保留自己的 store，实现协议语义（服务内部审批门、预算、审计） |
| 想喂/读 **dsh-memento** store 的 DSH 插件 | **适配器注册** | 在 `ctx.memoryAdapters` 上注册适配器；你的外部格式与协议条目互转 |

本指南讲适配器这条路。如果你的插件保留自己的 store、只想**互操作**，注册一个把你 store
导出格式转成协议条目的适配器即可；导入/导出随后走同一条带审批门的 `seed` 路径。

## 适配器契约

```js
// your-plugin/adapters/my-format.mjs
export const myFormatAdapter = {
  id: 'my-format',               // 小写 kebab-case，注册表内唯一
  name: 'My format',
  description: 'Converts my-format exports to protocol entries and back.',
  version: '1.0.0',
  importFormats: ['my-format-v1'],   // /memory adapters 展示的格式标签
  exportFormat: 'my-format-v1',

  // 载荷 -> 协议条目输入。只做纯数据转换：
  // 绝不调用模型做抽取或摘要。
  adapt(payload) {
    // return { entries: [{ track, scope, text, source?, tags?, workspaceKey?, agentKey? }] }
  },

  // 协议条目 -> 你的格式（JSON 安全值）
  export(entries) {
    // return 你的格式文档
  },
}
```

## 注册（可逆）

```js
import { myFormatAdapter } from './adapters/my-format.mjs'

export function apply(ctx) {
  const adapters = ctx.get('memoryAdapters')   // 可选依赖：dsh-memento 可能未挂载
  if (adapters !== undefined) {
    // register() 返回 disposer——交给 ctx.effect，插件停止/更新时 Cordis 自动注销。
    ctx.effect(() => adapters.register(myFormatAdapter))
  }
}
```

注册错误响亮失败（形状非法、id 重复都报 `INVALID_INPUT`）。绝不捕获后吞掉。

## 保持合规的转换规则

1. **只转换数据，不推理。** 载荷里没有事实级条目（如原始聊天记录）时响亮失败（`ADAPTER_PAYLOAD`）
   并告知调用方先抽取。协议是存储互操作面，不是推理面。
2. **校验每个输出字段。** `track`/`scope` 必须是协议词汇；`text` 非空；`tags` ≤16 个 × ≤32 字符。
   `seed` 会再校验一遍，但好适配器从不产出垃圾。
3. **不可表示的结构响亮失败。** 无法映射成条目的行应带行号报错，而不是变成一条烂条目。
4. **在 `description` 里诚实说明有损性。** `export` 可能省略你的格式没有概念的字段（如 tags）——
   明说。
5. **幂等且无副作用。** `adapt`/`export` 不得写文件、联网、碰 store。导入落库发生在 `seed`——
   一次审批、一个事务、逐条审计。

## 用户得到什么

适配器注册后（随你的插件发布，或任何人运行时注册），这些界面免费亮起：

```sh
/memory adapters                                  # 列出已注册适配器与格式
/memory import --adapter=my-format ./export.json  # 转换 + seed：一次审批、逐条审计
/memory export --adapter=my-format                # 只读转换输出到 stdout
```

## 参考适配器（dsh-memento 随附）

| 适配器 id | 外部格式 | 说明 |
| --- | --- | --- |
| `mem0` | mem0 事实集合（`{facts: [{memory, metadata?}]}` 或裸数组） | `metadata.category`/`metadata.tags` 变成标签；原始 `messages` 数组被拒——抽取是调用方的事 |
| `hermes-memory-md` | Hermes `memory.md`（`## 小节` + 项目符号） | 小节名变标签；非项目符号散文行响亮失败 |
| `claude-code-memory-md` | `CLAUDE.md` 风格 markdown（标题、项目符号、段落） | 项目符号与空行分段的段落各成条目；小节名变标签 |

这些是契约的成品示例——配合本指南读 `lib/adapters.mjs`。
