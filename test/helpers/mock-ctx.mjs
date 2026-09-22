// test/helpers/mock-ctx.mjs — 极简 Cordis 模拟（集成测试用）。
//
// 只实现 dsh-memento 用到的面：on/effect/inject/provide/get/tools.register/
// systemPrompt.section/waterfall/approval。语义对齐真 Cordis 的关键点：
// - effect 回调返回清理函数，卸载时逆序执行；ctx.effect 返回的是可调用的 disposer
//   （真 Cordis 的 Disposable 就是函数），重复调用是 no-op；
// - provide 的 disposer 与 effect 一样随卸载生效（近似 fiber 自动回收）；
// - inject 在依赖服务齐备时立即回调，否则登记、provide 齐备时补回调；
// - **inject 的回调拿到子 Context**（真 Cordis 里 inject = ctx.plugin({inject, apply})，
//   apply 的 ctx 是子 fiber 的 Context：既有服务属性面，也有 get/effect/on）；服务被
//   替换时旧子 fiber 先卸载、再重跑回调；
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
  /** @type {Array<() => boolean>} */
  const pendingInjects = []
  /** @type {Array<{deps: string[], attempt: () => boolean}>} */
  const activeInjects = []
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
      // 真 Cordis 的 ctx.effect 返回可调用的 disposer，且重复调用是 no-op；
      // 自持 disposer 的插件（运行期拆旧装新）依赖这一形态。
      let disposed = false
      const dispose = () => {
        if (disposed) return
        disposed = true
        if (typeof cleanup === 'function') cleanup()
      }
      cleanups.push(dispose)
      return dispose
    },
    inject(deps, callback) {
      // 真 Cordis：回调拿到子 fiber 的 Context（服务属性面 + get/effect/on 都在），
      // 子 fiber 卸载时它自己的 effect 一并回收。
      /** @type {{cleanups: Array<() => void>} | null} */
      let child = null
      const disposeChild = () => {
        if (child === null) return
        const held = child
        child = null
        for (const cleanup of held.cleanups.reverse()) cleanup()
      }
      const attempt = () => {
        const faces = deps.map((name) => services.get(name))
        if (faces.some((face) => face === undefined)) return false
        disposeChild()
        const held = { cleanups: /** @type {Array<() => void>} */ ([]) }
        /** @type {Record<string, unknown>} */
        const face = {
          get: (/** @type {string} */ name) => services.get(name),
          on: (/** @type {string} */ name, /** @type {Function} */ fn, /** @type {object|boolean|undefined} */ options) => ctx.on(name, fn, options),
          effect(/** @type {() => unknown} */ cb) {
            let cleanup
            try {
              cleanup = cb()
            } catch (error) {
              cleanup = () => { throw error }
            }
            let disposed = false
            const dispose = () => {
              if (disposed) return
              disposed = true
              if (typeof cleanup === 'function') cleanup()
            }
            held.cleanups.push(dispose)
            return dispose
          },
        }
        deps.forEach((/** @type {string} */ name, /** @type {number} */ index) => { face[name] = faces[index] })
        child = held
        callback(face)
        return true
      }
      const record = { deps, attempt }
      if (!attempt()) pendingInjects.push(record)
      else activeInjects.push(record)
      // 插件 fiber 卸载时子 fiber 一并卸载（真 Cordis 的父子 fiber 关系）。
      cleanups.push(disposeChild)
      return () => {}
    },
    provide(name, value) {
      services.set(name, value)
      // 服务替换：依赖它的子 fiber 先卸载、回调再跑一遍（真 Cordis 的 inject 语义）。
      // 先处理**已在场**的注入，再激活待定的——否则本次激活会被自己的替换循环二次触发。
      for (const record of [...activeInjects]) {
        if (record.deps.includes(name)) record.attempt()
      }
      for (let index = pendingInjects.length - 1; index >= 0; index--) {
        if (pendingInjects[index].attempt()) {
          activeInjects.push(pendingInjects[index])
          pendingInjects.splice(index, 1)
        }
      }
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
 * @param {object} [opts] - {id, cwd, agentPreset}。
 * @returns {object} 会话假件。
 */
export function makeSession(opts = {}) {
  const id = opts.id ?? 'session-test'
  const cwd = opts.cwd ?? 'C:\\work\\proj'
  const events = []
  return {
    id,
    events,
    header: { cwd, ...(opts.agentPreset === undefined ? {} : { agentPreset: opts.agentPreset }) },
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
