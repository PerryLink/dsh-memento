// test/helpers/mock-ctx.mjs — 极简 Cordis 模拟（集成测试用）。
//
// 只实现 dsh-memento 用到的面：on/effect/provide/get/tools.register/
// systemPrompt.section/waterfall/approval。语义对齐真 Cordis 的关键点：
// - effect 回调返回清理函数，卸载时逆序执行；
// - provide 的 disposer 与 effect 一样随卸载生效（近似 fiber 自动回收）；
// - waterfall 的 next() 续链、prepend 排序。

/**
 * 构造 mock 上下文。
 * @param {object} [opts] - {approval}：可编程审批服务（默认 request → 'unavailable'）。
 * @returns {object} {ctx, services, tools, sections, listeners, cleanups, waterfall, dispose}。
 */
export function createMockCtx(opts = {}) {
  const services = new Map()
  const tools = []
  const sections = []
  const listeners = new Map()
  const cleanups = []
  const approval = opts.approval ?? { request: async () => 'unavailable' }

  const ctx = {
    on(name, fn, options) {
      const list = listeners.get(name) ?? []
      const record = { fn }
      if (options === true || options?.prepend === true) list.unshift(record)
      else list.push(record)
      listeners.set(name, list)
      return () => true
    },
    effect(callback, _label) {
      let cleanup
      try {
        cleanup = callback()
      } catch (error) {
        cleanup = () => { throw error }
      }
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return { dispose() {} }
    },
    provide(name, value) {
      services.set(name, value)
      const remove = () => { services.delete(name) }
      cleanups.push(remove)
      return remove
    },
    get(name) {
      return services.get(name)
    },
    tools: {
      register(def) {
        tools.push(def)
        return () => {
          const index = tools.indexOf(def)
          if (index >= 0) tools.splice(index, 1)
        }
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {
          const index = sections.indexOf(section)
          if (index >= 0) sections.splice(index, 1)
        }
      },
    },
    approval,
    logger: { warn() {}, error() {}, info() {}, debug() {} },
    root: null,
    emit(name, ...args) {
      for (const record of listeners.get(name) ?? []) record.fn(...args)
    },
    waterfall(name, ...args) {
      const terminal = args.pop()
      const fns = (listeners.get(name) ?? []).slice()
      const run = (index, rest) => {
        if (index >= fns.length) return terminal(...rest)
        return fns[index].fn(...rest, (...nextArgs) => run(index + 1, nextArgs))
      }
      return run(0, args)
    },
  }
  ctx.root = ctx
  return {
    ctx,
    services,
    tools,
    sections,
    listeners,
    cleanups,
    waterfall: (name, ...args) => ctx.waterfall(name, ...args),
    /** 模拟 fiber 卸载：逆序执行清理。 */
    dispose() {
      for (const cleanup of cleanups.reverse()) cleanup()
    },
  }
}

/**
 * 合成会话：events 记录 append 内容（S2 重建断言用）。
 * @param {object} [opts] - {id, cwd}。
 * @returns {object} 会话假件。
 */
export function makeSession(opts = {}) {
  const id = opts.id ?? 'session-test'
  const cwd = opts.cwd ?? 'C:\\work\\proj'
  const events = []
  return {
    id,
    events,
    header: { cwd },
    append(type, data) {
      const event = { type, seq: events.length, time: Date.now(), data }
      events.push(event)
      return event
    },
  }
}

/**
 * 合成 agent：带 session 与最小审批所需面。
 * @param {object} [session] - makeSession 产物。
 * @returns {object} agent 假件。
 */
export function makeAgent(session) {
  return { session: session ?? makeSession() }
}

/** 合成 exec（工具执行上下文）：agent + callId + 未中止的 signal。 */
export function makeExec(opts = {}) {
  const controller = opts.controller ?? new AbortController()
  return {
    // 显式传 undefined 表示"无 agent"（?? 会吞掉它，必须用 in 判定）。
    agent: 'agent' in opts ? opts.agent : makeAgent(),
    callId: opts.callId ?? 'call-1',
    signal: controller.signal,
    token: {},
    parent: undefined,
    name: 'memory',
    arguments: {},
    controller,
  }
}
