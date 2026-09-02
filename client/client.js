// SPDX-License-Identifier: Apache-2.0
// client/client.js — dsh-memento 浏览器观察面板（F9，零构建 vanilla）。
//
// host 端 dsh.client 扫描把本文件作为 classic script 注入 __DSH_BOOT__ 图，
// 执行时经 window.__ModuleLoader__.load 注册工厂；apply 挂载浮层抽屉面板。
// 面板只读：条目浏览/搜索/预算条/审计尾，全部走本插件自注册的
// /api/memento/* JSON 路由（只走公开 API）。写与审批在 DSH 内置审批 UI 完成，
// 面板不产生任何模型可见内容、不做任何审批决策。
// 面板文案随 Config.language（en/zh）切换，语言来自 entries 路由响应。

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
