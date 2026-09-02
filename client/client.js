// SPDX-License-Identifier: Apache-2.0
// client/client.js — dsh-memento 浏览器观察面板（F9，零构建 vanilla）。
//
// host 端 dsh.client 扫描把本文件作为 classic script 注入 __DSH_BOOT__ 图，
// 执行时经 window.__ModuleLoader__.load 注册工厂；apply 挂载浮层抽屉面板。
// 面板只读：条目浏览/搜索/预算条/审计尾，全部走本插件自注册的
// /api/memento/* JSON 路由（只走公开 API）。写与审批在 DSH 内置审批 UI 完成，
// 面板不产生任何模型可见内容、不做任何审批决策。
// 面板文案随 Config.language（en/zh）切换，语言来自 entries 路由响应。
//
// 本文件同时注册第二个客户端模块 dsh-memento/settings-section：宿主设置弹窗
// 左侧菜单的一级设置项（settings.section，id = dsh-memento），与通用设置、
// 插件、能力库等并列。页面经 ctx.settingsScope 读/写用户层（settings.yaml），
// 暂存—保存语义与宿主内置卡片一致；factory 的 require 由宿主模块系统提供
// （react 为平台内置模块）。

(function () {
  'use strict'
  if (typeof window === 'undefined' || !window.__ModuleLoader__ || !window.__ModuleLoader__.load) return
  window.__ModuleLoader__.load({
    id: 'dsh-memento',
    factory: function () {
      return {
        name: 'memento-panel',
        inject: [],
        apply: function () { void bootPanel() },
      }
    },
  })
})()

const PANEL_ID = 'dsh-memento-panel'

/** 面板文案（en 源文 / zh 译文；语言来自 /api/memento/entries 响应的 language 字段，缺省 en）。 */
const STRINGS = {
  en: {
    open: '🧠 Memory',
    title: 'dsh-memento memory',
    refresh: 'Refresh',
    close: 'Close',
    filter: 'Filter entries by text…',
    empty: 'Memory is empty (or nothing matches the filter). Use the memory tool to write (approval happens in the built-in approval UI).',
    truncated: (shown, total) => `Showing the first ${shown} of ${total} entries — narrow the filter to see more.`,
    groupCount: (n) => `(${n})`,
    budgets: 'Budget usage',
    audit: 'Recent audit',
    loading: 'Loading…',
    auditEmpty: 'Audit is empty',
    proposals: 'Pending proposals',
    proposalsEmpty: 'No pending proposals (generated after session compaction; decide via /memory proposals approve|dismiss)',
    loadFailed: (message) => `Load failed: ${message} (panel is read-only; make sure the Web profile has dsh-memento loaded)`,
  },
  zh: {
    open: '🧠 记忆',
    title: 'dsh-memento 记忆',
    refresh: '刷新',
    close: '关闭',
    filter: '按文本过滤条目…',
    empty: '记忆为空（或没有匹配当前过滤）。写操作请用 memory 工具（审批在 DS 内置审批 UI 完成）。',
    truncated: (shown, total) => `仅显示前 ${shown} 条，共 ${total} 条——用过滤框缩小范围。`,
    groupCount: (n) => `（${n} 条）`,
    budgets: '预算用量',
    audit: '最近审计',
    loading: '加载中…',
    auditEmpty: '审计为空',
    proposals: '待审批提案',
    proposalsEmpty: '暂无待审批提案（会话压缩后自动生成；用 /memory proposals approve|dismiss 处理）',
    loadFailed: (message) => `加载失败：${message}（面板只读；请确认 Web profile 已装载 dsh-memento）`,
  },
}

/**
 * 启动探测：panel.enabled=false 时入口按钮不渲染（设置面板可随时改回）；
 * 探测失败按开启处理，行为与未引入开关前的版本一致。
 * @returns {Promise<{enabled: boolean, language: string}>}。
 */
async function probePanelState() {
  try {
    const response = await fetch('/api/memento/entries?limit=1')
    if (response.ok) {
      const data = await response.json()
      if (data.error === undefined) {
        return { enabled: data.panel?.enabled !== false, language: data.language ?? 'en' }
      }
    }
  } catch {
    // 探测失败：保持默认开启。
  }
  return { enabled: true, language: 'en' }
}

async function bootPanel() {
  const state = await probePanelState()
  if (!state.enabled) return
  installPanel(state)
}

function installPanel(state) {
  if (document.getElementById(PANEL_ID)) return
  let S = STRINGS[state.language] ?? STRINGS.en

  const style = document.createElement('style')
  style.textContent = `
#dsh-memento-panel { position: fixed; z-index: 2147483000; font: 13px/1.5 system-ui, "Segoe UI", sans-serif; }
#mem-open { position: fixed; right: 16px; bottom: 56px; z-index: 2147483000; padding: 8px 14px; border: 1px solid #3f6fae;
  border-radius: 999px; background: #0d1526; color: #7db4ff; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
#mem-open:hover { background: #16233c; }
#mem-drawer { position: fixed; right: 0; top: 0; bottom: 0; width: 460px; max-width: 92vw; display: flex; flex-direction: column;
  background: #101827; color: #d7e2f2; border-left: 1px solid #24344d; box-shadow: -8px 0 24px rgba(0,0,0,.4); }
#mem-head { padding: 10px 12px; border-bottom: 1px solid #24344d; display: flex; gap: 8px; align-items: center; }
#mem-head b { flex: 1; }
#mem-head button { background: #1c2a42; color: #cfe1f7; border: 1px solid #2f4466; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
#mem-head button:hover { background: #27395a; }
#mem-filter { margin: 8px 12px; padding: 6px 8px; background: #0b1120; color: #d7e2f2; border: 1px solid #24344d; border-radius: 6px; }
#mem-body { flex: 1; overflow: auto; padding: 0 12px 12px; }
.mem-group { margin: 10px 0 4px; color: #8fb4e8; }
.mem-entry { padding: 6px 8px; margin: 3px 0; border: 1px solid #24344d; border-radius: 8px; background: #131e33; }
.mem-entry .t { display: block; color: #e6eefb; }
.mem-entry .m { display: block; color: #9fb4d4; font-size: 11px; }
.mem-bar { height: 6px; margin: 6px 0 2px; background: #0b1120; border-radius: 3px; overflow: hidden; border: 1px solid #24344d; }
.mem-bar i { display: block; height: 100%; background: #3f6fae; }
.mem-row { margin: 6px 0; color: #9fb4d4; }
.mem-audit { margin: 6px 0; padding: 4px 8px; border-left: 2px solid #3f6fae; color: #9fb4d4; font-size: 12px; }
.mem-empty { color: #8fa8cc; margin: 10px 0; }
`

  const openBtn = document.createElement('button')
  openBtn.id = 'mem-open'
  openBtn.textContent = S.open

  const root = document.createElement('div')
  root.id = PANEL_ID
  const drawer = document.createElement('div')
  drawer.id = 'mem-drawer'
  drawer.style.display = 'none'
  drawer.innerHTML = `
    <div id="mem-head"><b id="mem-title">${S.title}</b>
      <button id="mem-refresh" title="${S.refresh}">${S.refresh}</button>
      <button id="mem-close" title="${S.close}">✕</button>
    </div>
    <input id="mem-filter" placeholder="${S.filter}" />
    <div id="mem-body"></div>
  `
  root.appendChild(openBtn)
  root.appendChild(drawer)
  document.body.appendChild(root)
  document.head.appendChild(style)

  const body = document.getElementById('mem-body')
  const filter = document.getElementById('mem-filter')
  const titleLabel = document.getElementById('mem-title')
  const refreshBtn = document.getElementById('mem-refresh')
  const closeBtn = document.getElementById('mem-close')
  const filterInput = document.getElementById('mem-filter')

  /** 按服务端 language 切换文案并刷新静态标签（语言随配置，运行期不变）。 */
  const applyLanguage = (language) => {
    S = STRINGS[language] ?? STRINGS.en
    openBtn.textContent = S.open
    titleLabel.textContent = S.title
    refreshBtn.title = S.refresh
    refreshBtn.textContent = S.refresh
    closeBtn.title = S.close
    filterInput.placeholder = S.filter
  }

  let entries = []
  let lastFilter = ''
  let lastTotal = 0
  let lastTruncated = false

  const render = () => {
    const visible = entries.filter((entry) => entry.text.toLowerCase().includes(lastFilter.toLowerCase()))
    const groups = new Map()
    for (const entry of visible) {
      const key = `${entry.track}/${entry.scope}`
      const list = groups.get(key)
      if (list === undefined) groups.set(key, [entry])
      else list.push(entry)
    }
    if (visible.length === 0) {
      body.innerHTML = `<div class="mem-empty">${S.empty}</div>`
      return
    }
    let html = lastTruncated
      ? `<div class="mem-empty">${S.truncated(entries.length, lastTotal)}</div>`
      : ''
    for (const [key, list] of groups) {
      html += `<div class="mem-group">${key}${S.groupCount(list.length)}</div>`
      for (const entry of list) {
        const agentTag = typeof entry.agentKey === 'string' && entry.agentKey.length > 0 ? ` · agent ${escapeHtml(entry.agentKey)}` : ''
        html += `<div class="mem-entry"><span class="t">${escapeHtml(entry.text)}</span><span class="m">${escapeHtml(entry.source)}${agentTag} · ${new Date(entry.createdAt).toLocaleString()}</span></div>`
      }
    }
    body.innerHTML = html
  }

  const renderBudget = (budgets) => {
    if (!Array.isArray(budgets) || budgets.length === 0) return
    let html = `<div class="mem-group">${S.budgets}</div>`
    for (const row of budgets) {
      const pct = row.limit > 0 ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0
      html += `<div class="mem-row">${row.track}/${row.scope}: ${row.used}/${row.limit}<div class="mem-bar"><i style="width:${pct}%"></i></div></div>`
    }
    html += `<div class="mem-group">${S.audit}</div>`
    html += `<div id="mem-audit-slot"><div class="mem-empty">${S.loading}</div></div>`
    html += `<div class="mem-group">${S.proposals}</div>`
    html += `<div id="mem-proposal-slot"><div class="mem-empty">${S.loading}</div></div>`
    body.insertAdjacentHTML('beforeend', html)
  }

  const renderAudit = (rows) => {
    const slot = document.getElementById('mem-audit-slot')
    if (slot === null) return
    if (!Array.isArray(rows) || rows.length === 0) {
      slot.innerHTML = `<div class="mem-empty">${S.auditEmpty}</div>`
      return
    }
    slot.innerHTML = rows.map((row) =>
      `<div class="mem-audit">${new Date(row.ts).toLocaleString()} ${escapeHtml(row.action)}${row.track ? ` ${escapeHtml(row.track)}/${escapeHtml(row.scope)}` : ''} · ${escapeHtml(row.outcome ?? '')} · ${escapeHtml(row.source ?? '')}</div>`).join('')
  }

  const renderProposals = (proposals) => {
    const slot = document.getElementById('mem-proposal-slot')
    if (slot === null) return
    if (!Array.isArray(proposals) || proposals.length === 0) {
      slot.innerHTML = `<div class="mem-empty">${S.proposalsEmpty}</div>`
      return
    }
    slot.innerHTML = proposals.map((proposal) =>
      `<div class="mem-audit">[${escapeHtml(proposal.id)}] ${escapeHtml(proposal.track)}/${escapeHtml(proposal.scope)} · ${escapeHtml(proposal.text.length > 160 ? `${proposal.text.slice(0, 160)}…` : proposal.text)}</div>`).join('')
  }

  const refresh = async () => {
    try {
      const response = await fetch('/api/memento/entries?limit=200')
      if (!response.ok) throw new Error(`entries ${response.status}`)
      const data = await response.json()
      if (data.error !== undefined) throw new Error(data.error)
      applyLanguage(data.language)
      entries = Array.isArray(data.entries) ? data.entries : []
      lastTotal = Number.isInteger(data.total) ? data.total : entries.length
      lastTruncated = data.truncated === true
      render()
      renderBudget(data.budgets)
      void fetch('/api/memento/audit?limit=20')
        .then((res) => res.json())
        .then((audit) => renderAudit(audit.rows))
        .catch(() => renderAudit([]))
      void fetch('/api/memento/proposals')
        .then((res) => res.json())
        .then((data) => renderProposals(data.proposals))
        .catch(() => renderProposals([]))
    } catch (error) {
      body.innerHTML = `<div class="mem-empty">${S.loadFailed(String(error && error.message ? error.message : error))}</div>`
    }
  }

  openBtn.addEventListener('click', () => {
    drawer.style.display = drawer.style.display === 'none' ? 'flex' : 'none'
    if (drawer.style.display !== 'none') void refresh()
  })
  closeBtn.addEventListener('click', () => { drawer.style.display = 'none' })
  refreshBtn.addEventListener('click', () => void refresh())
  filter.addEventListener('input', () => {
    lastFilter = filter.value
    render()
  })
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

// ── 宿主设置页（settings.section 一级项，id = dsh-memento）──────────────
;(function () {
  'use strict'
  if (typeof window === 'undefined' || !window.__ModuleLoader__ || !window.__ModuleLoader__.load) return
  window.__ModuleLoader__.load({
    id: 'dsh-memento/settings-section',
    factory: function (require) {
      const react = require('react')
      /** createElement 简写（宿主平台内置 react，无需构建期 JSX 编译）。 */
      const jsx = react.createElement

      /** 卡片文案（en 源文 / zh 译文；语言跟随 namespace value.language，保存后即时切换）。 */
      const CARD_STRINGS = {
        en: {
          title: 'dsh-memento memory',
          description: 'Approval-gated cross-session memory. Writes, snapshot wording and the floating panel follow these values.',
          sectionPermissions: 'Write approval policy',
          sectionPanel: 'Floating panel',
          sectionLanguage: 'Language',
          sectionBudgets: 'Character budgets (per track/layer)',
          sectionLimits: 'Query & command limits',
          sectionRecall: 'Recall defaults',
          sectionPanelPage: 'Panel page limits',
          sectionProposals: 'Auto-capture proposals',
          sectionStorage: 'Storage & audit retention',
          sectionAdvanced: 'Advanced (applied after DSH reload)',
          writePolicy: 'Global write policy',
          writePolicies: 'Per-track/scope policies',
          writePoliciesHint: 'One per line: track/scope=policy or source:name=policy. Unknown keys fail validation on save.',
          panelEnabled: 'Show the floating panel button',
          language: 'Language',
          budgetUserGlobal: 'user / user-global',
          budgetUserWorkspace: 'user / workspace',
          budgetAgentGlobal: 'agent / user-global',
          budgetAgentWorkspace: 'agent / workspace',
          maxEntriesPerQuery: 'query default limit',
          commandListLimit: '/memory list|query page limit',
          commandAuditLimit: '/memory audit page limit',
          recallHistoryLimit: 'history sessions per recall',
          recallSnippetCap: 'snippets per session',
          recallSnippetChars: 'snippet characters',
          recallWindowDays: 'history window (days)',
          panelEntriesLimit: 'entries page limit',
          panelAuditLimit: 'audit page limit',
          proposalsEnabled: 'Generate proposals after compaction',
          proposalsMaxChars: 'proposal max characters',
          proposalsMaxPending: 'max pending proposals',
          dbPath: 'Memory database path',
          dbPathHint: 'Empty = default ($DSH_HOME/dsh-memento/memory.db). Saving reopens the store immediately.',
          snapshotOrder: 'Snapshot section order',
          auditRetentionDays: 'Audit retention (days, 0 = unlimited)',
          retrievalVector: 'Vector recall (when an embedding provider exists)',
          reloadHint: 'Applied after DSH reload',
          overridden: 'Overridden',
          reset: 'Reset',
          resetField: 'Reset field',
          save: 'Save',
          saving: 'Saving…',
          discard: 'Discard',
          unsaved: 'Unsaved changes',
          saveFailed: 'Save failed — drafts kept for correction.',
          readOnly: 'Read-only (settings service unavailable).',
          invalidNumber: 'Must be a whole number.',
          invalidPolicy: 'Must be ask, auto or off.',
        },
        zh: {
          title: 'dsh-memento 记忆',
          description: '带审批门的跨会话记忆。写入策略、快照文案与悬浮窗跟随这些值。',
          sectionPermissions: '写审批策略',
          sectionPanel: '悬浮窗',
          sectionLanguage: '语言',
          sectionBudgets: '字符预算（每轨道/层）',
          sectionLimits: '查询与命令上限',
          sectionRecall: '召回默认值',
          sectionPanelPage: '面板页上限',
          sectionProposals: '自动捕捉提案',
          sectionStorage: '存储与审计保留',
          sectionAdvanced: '高级（DSH 重载后生效）',
          writePolicy: '全局写策略',
          writePolicies: '按轨道/层粒度策略',
          writePoliciesHint: '每行一条：track/scope=策略 或 source:name=策略。保存时无法识别的键会被校验拒绝。',
          panelEnabled: '显示悬浮窗入口按钮',
          language: '语言',
          budgetUserGlobal: 'user / user-global',
          budgetUserWorkspace: 'user / workspace',
          budgetAgentGlobal: 'agent / user-global',
          budgetAgentWorkspace: 'agent / workspace',
          maxEntriesPerQuery: 'query 默认上限',
          commandListLimit: '/memory list|query 单页上限',
          commandAuditLimit: '/memory audit 单页上限',
          recallHistoryLimit: '每次召回扫描会话数',
          recallSnippetCap: '每会话片段数',
          recallSnippetChars: '片段字符数',
          recallWindowDays: '历史窗口（天）',
          panelEntriesLimit: '条目单页上限',
          panelAuditLimit: '审计单页上限',
          proposalsEnabled: '压缩结束后生成提案',
          proposalsMaxChars: '提案最大字符数',
          proposalsMaxPending: '待审批提案上限',
          dbPath: '记忆库路径',
          dbPathHint: '留空 = 默认（$DSH_HOME/dsh-memento/memory.db）。保存后立即重开记忆库。',
          snapshotOrder: '快照段注入顺序',
          auditRetentionDays: '审计保留天数（0 = 不限）',
          retrievalVector: '向量召回（存在 embedding provider 时）',
          reloadHint: 'DSH 重载后生效',
          overridden: '已覆盖',
          reset: '重置',
          resetField: '重置该字段',
          save: '保存',
          saving: '保存中…',
          discard: '放弃修改',
          unsaved: '有未保存修改',
          saveFailed: '保存失败——草稿已保留，可修正后重试。',
          readOnly: '只读（设置服务不可用）。',
          invalidNumber: '必须是整数。',
          invalidPolicy: '必须是 ask、auto 或 off。',
        },
      }

      /** 顶层字段名（保存按顶层聚合：scope.set(topField, 合并值)，不依赖点路径写入面）。 */
      const POLICIES = ['ask', 'auto', 'off']

      /** 简版快照 store（useSyncExternalStore 形状：{getSnapshot, subscribe}+set）。 */
      function createSnapshotStore(initial) {
        let snapshot = initial
        const listeners = new Set()
        return {
          getSnapshot() { return snapshot },
          subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
          set(next) { snapshot = next; for (const fn of listeners) fn() },
        }
      }

      /** 读点路径（'a.b' → obj?.a?.b）。 */
      function pathValue(obj, path) {
        let cursor = obj
        for (const key of path.split('.')) {
          if (cursor === null || typeof cursor !== 'object') return undefined
          cursor = cursor[key]
        }
        return cursor
      }

      /** 判定子字段是否被用户层覆盖（user 层子路径 hasOwn）。 */
      function pathStored(user, path) {
        const keys = path.split('.')
        const last = keys.pop()
        let cursor = user
        for (const key of keys) {
          if (cursor === null || typeof cursor !== 'object') return false
          cursor = cursor[key]
        }
        return cursor !== null && typeof cursor === 'object' && Object.hasOwn(cursor, last)
      }

      /** 深合并（草稿子树 → 当前顶层值；数组与标量直接替换）。 */
      function deepMerge(base, patch) {
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
        const out = { ...(base !== null && typeof base === 'object' && !Array.isArray(base) ? base : {}) }
        for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(out[key], value)
        return out
      }

      /** 子字段规格：path + kind（number/text/bool/choice/policies）+ choice 候选。 */
      const FIELD_SPECS = [
        { path: 'writePolicy', kind: 'choice', choices: POLICIES },
        { path: 'writePolicies', kind: 'policies' },
        { path: 'panel.enabled', kind: 'bool' },
        { path: 'language', kind: 'choice', choices: ['en', 'zh'] },
        { path: 'budgets.user.userGlobal', kind: 'number' },
        { path: 'budgets.user.workspace', kind: 'number' },
        { path: 'budgets.agent.userGlobal', kind: 'number' },
        { path: 'budgets.agent.workspace', kind: 'number' },
        { path: 'maxEntriesPerQuery', kind: 'number' },
        { path: 'commandListLimit', kind: 'number' },
        { path: 'commandAuditLimit', kind: 'number' },
        { path: 'recall.historyLimitDefault', kind: 'number' },
        { path: 'recall.snippetCap', kind: 'number' },
        { path: 'recall.snippetChars', kind: 'number' },
        { path: 'recall.windowDays', kind: 'number' },
        { path: 'panelEntriesLimit', kind: 'number' },
        { path: 'panelAuditLimit', kind: 'number' },
        { path: 'proposals.enabled', kind: 'bool' },
        { path: 'proposals.maxChars', kind: 'number' },
        { path: 'proposals.maxPending', kind: 'number' },
        { path: 'dbPath', kind: 'text' },
        { path: 'snapshotOrder', kind: 'number' },
        { path: 'auditRetentionDays', kind: 'number' },
        { path: 'retrieval.vector', kind: 'bool' },
      ]
      const SPEC_BY_PATH = new Map(FIELD_SPECS.map((spec) => [spec.path, spec]))
      const RELOAD_PATHS = new Set(['snapshotOrder'])

      /** 草稿文本 → 顶层字段写入计划；无法解析的草稿返回 undefined（阻塞保存）。 */
      function parseDraftText(spec, text, currentValue) {
        if (spec.kind === 'bool') {
          if (text === 'true') return { ok: true, value: true }
          if (text === 'false') return { ok: true, value: false }
          return { ok: false }
        }
        if (spec.kind === 'choice') {
          return spec.choices.includes(text) ? { ok: true, value: text } : { ok: false }
        }
        if (spec.kind === 'number') {
          const trimmed = text.trim()
          const parsed = Number(trimmed)
          return trimmed !== '' && Number.isFinite(parsed) && Number.isInteger(parsed) ? { ok: true, value: parsed } : { ok: false }
        }
        if (spec.kind === 'policies') {
          const next = {}
          for (const rawLine of text.split('\n')) {
            const line = rawLine.trim()
            if (line === '') continue
            const eq = line.indexOf('=')
            if (eq <= 0) return { ok: false }
            const key = line.slice(0, eq).trim()
            const policy = line.slice(eq + 1).trim()
            if (key === '' || !POLICIES.includes(policy)) return { ok: false }
            next[key] = policy
          }
          return { ok: true, value: next }
        }
        // text：空串 = 恢复 base 语义由 clear 处理，这里空串写空字符串（dbPath 空 = 默认路径）。
        void currentValue
        return { ok: true, value: text }
      }

      /** 子字段格式化（快照值 → 控件文本）。 */
      function formatValue(value) {
        if (value === undefined || value === null) return ''
        if (typeof value === 'boolean') return value ? 'true' : 'false'
        return String(value)
      }

      /** policies 顶层对象的控件文本（每行 key=policy）。 */
      function formatPolicies(value) {
        if (value === null || typeof value !== 'object') return ''
        return Object.entries(value).map(([key, policy]) => `${key}=${policy}`).join('\n')
      }

      /**
       * 暂存表单（学宿主 CardForm：staged → save 才写；revision 栅防并发覆盖）。
       * 顶层聚合：同顶层字段的多个子字段草稿一次 scope.set(top, 合并值)。
       */
      class CardForm {
        constructor(scope) {
          this.scope = scope
          /** @type {Map<string, string>} */
          this.staged = new Map()
          this.saving = false
          this.failed = false
          this.listeners = new Set()
          scope.subscribe(() => this.publish())
        }

        bind(project) {
          const store = createSnapshotStore(project())
          this.listeners.add(() => store.set(project()))
          return store
        }

        stage(path, text) {
          this.staged.set(path, text)
          this.failed = false
          this.publish()
        }

        discard() {
          if (this.staged.size === 0 && !this.failed) return
          this.staged.clear()
          this.failed = false
          this.publish()
        }

        async save() {
          if (this.saving || this.staged.size === 0) return
          const snapshot = this.scope.getSnapshot()
          if (snapshot.status !== 'ready' || !snapshot.writable) return
          /** @type {Map<string, object>} */
          const tops = new Map()
          let valid = true
          for (const [path, text] of this.staged) {
            const spec = SPEC_BY_PATH.get(path)
            const keys = path.split('.')
            const top = keys[0]
            const parsed = parseDraftText(spec, text, snapshot.value)
            if (!parsed.ok) { valid = false; continue }
            const base = tops.get(top) ?? (snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value[top] : undefined)
            const merged = keys.length === 1
              ? parsed.value
              : deepMerge(base, (() => { /** @type {Record<string, unknown>} */ const out = {}; let cursor = out; for (let i = 1; i < keys.length - 1; i++) { cursor[keys[i]] = {}; cursor = cursor[keys[i]] } cursor[keys[keys.length - 1]] = parsed.value; return out })())
            tops.set(top, merged)
          }
          if (!valid || this.staged.size === 0) { this.publish(); return }
          this.saving = true
          this.failed = false
          this.publish()
          let landed = true
          for (const [top, value] of tops) {
            try {
              await this.scope.set(top, value)
            } catch {
              landed = false
            }
          }
          if (landed) this.staged.clear()
          this.saving = false
          this.failed = !landed
          this.publish()
        }

        fieldState(path) {
          const spec = SPEC_BY_PATH.get(path)
          const snapshot = this.scope.getSnapshot()
          const staged = this.staged.get(path)
          const effective = pathValue(snapshot.value, path)
          const overridden = pathStored(snapshot.user, path)
          if (staged === undefined) {
            const text = spec.kind === 'policies' ? formatPolicies(effective) : formatValue(effective)
            return { text, overridden, invalid: false }
          }
          const parsed = parseDraftText(spec, staged, snapshot.value)
          return { text: staged, overridden: true, invalid: !parsed.ok }
        }

        shell() {
          const snapshot = this.scope.getSnapshot()
          let invalid = false
          for (const [path, text] of this.staged) {
            if (!parseDraftText(SPEC_BY_PATH.get(path), text, snapshot.value).ok) invalid = true
          }
          return {
            available: snapshot.status === 'ready',
            writable: snapshot.writable === true,
            dirty: this.staged.size > 0,
            invalid,
            saving: this.saving,
            failed: this.failed,
            language: snapshot.value?.language,
          }
        }

        publish() {
          for (const listener of this.listeners) listener()
        }
      }

      /** 字段分组（卡片 UI 布局；reload 组标注重载生效）。 */
      const FIELD_GROUPS = [
        { key: 'sectionPermissions', paths: ['writePolicy', 'writePolicies'] },
        { key: 'sectionPanel', paths: ['panel.enabled'] },
        { key: 'sectionLanguage', paths: ['language'] },
        { key: 'sectionBudgets', paths: ['budgets.user.userGlobal', 'budgets.user.workspace', 'budgets.agent.userGlobal', 'budgets.agent.workspace'] },
        { key: 'sectionLimits', paths: ['maxEntriesPerQuery', 'commandListLimit', 'commandAuditLimit'] },
        { key: 'sectionRecall', paths: ['recall.historyLimitDefault', 'recall.snippetCap', 'recall.snippetChars', 'recall.windowDays', 'retrieval.vector'] },
        { key: 'sectionPanelPage', paths: ['panelEntriesLimit', 'panelAuditLimit'] },
        { key: 'sectionProposals', paths: ['proposals.enabled', 'proposals.maxChars', 'proposals.maxPending'] },
        { key: 'sectionStorage', paths: ['dbPath', 'auditRetentionDays'] },
        { key: 'sectionAdvanced', paths: ['snapshotOrder'] },
      ]

      let styleInstalled = false
      const CARD_CSS = `
.memcard { border: 1px solid var(--dsw-alias-border-l2, #2a3a55); border-radius: 10px; margin: 10px 0; background: var(--dsw-alias-bg-layer-3, #131e33); color: inherit; }
.memcard-head { display: flex; gap: 8px; align-items: center; padding: 12px; }
.memcard-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; }
.memcard-sub { font-size: 12px; color: var(--dsw-alias-label-secondary, #9fb4d4); }
.memcard-badge { white-space: nowrap; background: var(--dsw-alias-bg-module-platform, #1c2a42); color: var(--dsw-alias-label-secondary, #9fb4d4); border-radius: 999px; padding: 1px 8px; font-size: 11px; }
.memcard-body { padding: 0 12px 12px; }
.memcard-group { margin: 10px 0 2px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #8fb4e8); }
.memcard-field { display: flex; flex-direction: column; gap: 4px; padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l2, #24344d); }
.memcard-row { display: flex; gap: 8px; align-items: center; }
.memcard-label { flex: 1; min-width: 0; font-size: 13px; }
.memcard-input { border: 1px solid var(--dsw-alias-border-l2, #24344d); background: var(--dsw-alias-bg-layer-3, #0b1120); color: inherit; border-radius: 6px; padding: 4px 8px; font: inherit; min-width: 0; width: 220px; }
.memcard-input[aria-invalid="true"] { border-color: var(--dsw-alias-label-error, #e5534b); }
.memcard-textarea { width: 100%; min-height: 64px; font: 12px/1.5 ui-monospace, monospace; }
.memcard-hint, .memcard-invalid { margin: 0; font-size: 12px; }
.memcard-hint { color: var(--dsw-alias-label-tertiary, #6f87ad); }
.memcard-invalid { color: var(--dsw-alias-label-error, #e5534b); }
.memcard-override { font-size: 11px; color: var(--dsw-alias-label-secondary, #9fb4d4); }
.memcard-reset { font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary, #9fb4d4); cursor: pointer; background: 0 0; border: none; padding: 0; }
.memcard-footer { display: flex; gap: 8px; align-items: center; padding-top: 10px; }
.memcard-btn { font: inherit; font-size: 13px; border: 1px solid var(--dsw-alias-border-l2, #2f4466); background: var(--dsw-alias-bg-module-platform, #1c2a42); color: inherit; border-radius: 6px; padding: 4px 12px; cursor: pointer; }
.memcard-btn:disabled { opacity: 0.5; cursor: default; }
.memcard-failed { margin: 0; font-size: 12px; color: var(--dsw-alias-label-error, #e5534b); flex: 1; }
.memcard-readonly { margin: 0 0 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #6f87ad); }
`

      /** 单字段控件行（label + input/checkbox/select + override 徽标 + reset + hint/invalid）。 */
      function FieldRow(props) {
        const { t, spec, state, disabled, onEdit, onReset } = props
        const label = t(spec.path.replace(/\./g, '_'))
        const reloadBadge = RELOAD_PATHS.has(spec.path) ? jsx('span', { className: 'memcard-badge', title: t('reloadHint') }, '⟳') : null
        const invalid = spec.kind === 'choice' ? t('invalidPolicy') : t('invalidNumber')
        const control = spec.kind === 'bool'
          ? jsx('input', {
              type: 'checkbox', disabled,
              checked: state.text === 'true',
              onChange: (event) => onEdit(event.target.checked ? 'true' : 'false'),
            })
          : spec.kind === 'choice'
            ? jsx('select', {
                className: 'memcard-input', disabled, value: state.text,
                onChange: (event) => onEdit(event.target.value),
              }, spec.choices.map((choice) => jsx('option', { key: choice, value: choice }, choice)))
            : spec.kind === 'policies'
              ? jsx('textarea', {
                  className: 'memcard-input memcard-textarea', disabled,
                  value: state.text, 'aria-invalid': state.invalid,
                  onChange: (event) => onEdit(event.target.value),
                })
              : jsx('input', {
                  type: spec.kind === 'number' ? 'text' : 'text',
                  inputMode: spec.kind === 'number' ? 'numeric' : undefined,
                  className: 'memcard-input', disabled,
                  value: state.text, 'aria-invalid': state.invalid,
                  onChange: (event) => onEdit(event.target.value),
                })
        return jsx('div', { className: 'memcard-field' },
          jsx('div', { className: 'memcard-row' },
            jsx('label', { className: 'memcard-label' }, label, state.overridden ? jsx('span', { className: 'memcard-override' }, ` · ${t('overridden')}`) : null, reloadBadge),
            state.overridden ? jsx('button', { type: 'button', className: 'memcard-reset', disabled, title: t('resetField'), onClick: onReset }, t('reset')) : null,
            control,
          ),
          spec.path === 'writePolicies' ? jsx('p', { className: 'memcard-hint' }, t('writePoliciesHint'))
            : spec.path === 'dbPath' ? jsx('p', { className: 'memcard-hint' }, t('dbPathHint'))
              : null,
          state.invalid ? jsx('p', { className: 'memcard-invalid' }, invalid) : null,
        )
      }

      /** 设置页组件（settings.section 渲染入口；hooks share: mementoCard → useMementoCard）。 */
      function MementoSection(props) {
        const state = props.useMementoCard((snapshot) => snapshot)
        const language = state.language === 'zh' ? 'zh' : 'en'
        const t = (key) => CARD_STRINGS[language][key] ?? key
        const groups = state.available
          ? FIELD_GROUPS.map((group) => jsx('div', { key: group.key },
              jsx('div', { className: 'memcard-group' }, t(group.key)),
              group.paths.map((path) => {
                const spec = SPEC_BY_PATH.get(path)
                return jsx(FieldRow, {
                  key: path, t, spec, disabled: !state.writable,
                  state: state.fields[path],
                  onEdit: (text) => props.edit(path, text),
                  onReset: () => {
                    const baseValue = pathValue(props.base, path)
                    props.edit(path, spec.kind === 'policies' ? formatPolicies(baseValue) : formatValue(baseValue))
                  },
                })
              }),
            ))
          : null
        const blocked = !state.dirty || state.saving || state.invalid
        return jsx('div', { className: 'memcard' },
          jsx('div', { className: 'memcard-head' },
            jsx('span', { className: 'memcard-title' }, t('title')),
            jsx('span', { className: 'memcard-sub' }, t('description')),
            state.dirty ? jsx('span', { className: 'memcard-badge' }, t('unsaved')) : null,
          ),
          jsx('div', { className: 'memcard-body' },
            !state.available ? jsx('p', { className: 'memcard-readonly' }, t('readOnly')) : null,
            !state.writable ? jsx('p', { className: 'memcard-readonly' }, t('readOnly')) : null,
            groups,
            jsx('div', { className: 'memcard-footer' },
              state.failed ? jsx('p', { className: 'memcard-failed' }, t('saveFailed')) : null,
              jsx('button', { type: 'button', className: 'memcard-btn', disabled: !state.dirty || state.saving, onClick: props.discard }, t('discard')),
              jsx('button', { type: 'button', className: 'memcard-btn', disabled: blocked, onClick: props.save }, state.saving ? t('saving') : t('save')),
            ),
          ),
        )
      }

      /** 控制器：scope → 暂存表单 → 设置页快照。 */
      class MementoCardController {
        constructor(scope) {
          this.scope = scope
          this.form = new CardForm(scope)
          this.store = this.form.bind(() => this.projection())
        }

        projection() {
          /** @type {Record<string, {text: string, overridden: boolean, invalid: boolean}>} */
          const fields = {}
          for (const spec of FIELD_SPECS) fields[spec.path] = this.form.fieldState(spec.path)
          return { ...this.form.shell(), fields, base: this.scope.getSnapshot().base }
        }

        inject() {
          return {
            hooks: { mementoCard: this.store },
            edit: (path, text) => this.form.stage(path, text),
            discard: () => this.form.discard(),
            save: () => { void this.form.save() },
          }
        }
      }

      function apply(ctx) {
        if (!styleInstalled && typeof document !== 'undefined') {
          styleInstalled = true
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-memento'
          tag.textContent = CARD_CSS
          document.head.appendChild(tag)
        }
        const controller = new MementoCardController(ctx.settingsScope.bind({ namespace: 'dsh-memento' }))
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-memento',
          order: 16,
          label: 'dsh-memento',
          inject: () => controller.inject(),
        }, MementoSection)), 'dsh-memento: settings section')
      }

      return {
        name: 'memento-settings-section',
        inject: ['slots', 'settingsScope'],
        apply,
      }
    },
  })
})()
