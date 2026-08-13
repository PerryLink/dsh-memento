// SPDX-License-Identifier: MIT
// client/client.js — dsh-memento 浏览器观察面板（F9，零构建 vanilla）。
//
// host 端 dsh.client 扫描把本文件作为 classic script 注入 __DSH_BOOT__ 图，
// 执行时经 window.__ModuleLoader__.load 注册工厂；apply 挂载浮层抽屉面板。
// 面板只读：条目浏览/搜索/预算条/审计尾，全部走本插件自注册的
// /api/memento/* JSON 路由（只走公开 API）。写与审批在 DSH 内置审批 UI 完成，
// 面板不产生任何模型可见内容、不做任何审批决策。

(function () {
  'use strict'
  if (typeof window === 'undefined' || !window.__ModuleLoader__ || !window.__ModuleLoader__.load) return
  window.__ModuleLoader__.load({
    id: 'dsh-memento',
    factory: function () {
      return {
        name: 'memento-panel',
        inject: [],
        apply: function () { installPanel() },
      }
    },
  })
})()

const PANEL_ID = 'dsh-memento-panel'

function installPanel() {
  if (document.getElementById(PANEL_ID)) return

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
  openBtn.textContent = '🧠 记忆'

  const root = document.createElement('div')
  root.id = PANEL_ID
  const drawer = document.createElement('div')
  drawer.id = 'mem-drawer'
  drawer.style.display = 'none'
  drawer.innerHTML = `
    <div id="mem-head"><b>dsh-memento 记忆</b>
      <button id="mem-refresh" title="刷新">刷新</button>
      <button id="mem-close" title="关闭">✕</button>
    </div>
    <input id="mem-filter" placeholder="按文本过滤条目…" />
    <div id="mem-body"></div>
  `
  root.appendChild(openBtn)
  root.appendChild(drawer)
  document.body.appendChild(root)
  document.head.appendChild(style)

  const body = document.getElementById('mem-body')
  const filter = document.getElementById('mem-filter')
  let entries = []
  let lastFilter = ''

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
      body.innerHTML = '<div class="mem-empty">记忆为空（或没有匹配当前过滤）。写操作请用 memory 工具（审批在 DS 内置审批 UI 完成）。</div>'
      return
    }
    let html = ''
    for (const [key, list] of groups) {
      html += `<div class="mem-group">${key}（${list.length} 条）</div>`
      for (const entry of list) {
        html += `<div class="mem-entry"><span class="t">${escapeHtml(entry.text)}</span><span class="m">${escapeHtml(entry.source)} · ${new Date(entry.createdAt).toLocaleString()}</span></div>`
      }
    }
    body.innerHTML = html
  }

  const renderBudget = (budgets) => {
    if (!Array.isArray(budgets) || budgets.length === 0) return
    let html = '<div class="mem-group">预算用量</div>'
    for (const row of budgets) {
      const pct = row.limit > 0 ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0
      html += `<div class="mem-row">${row.track}/${row.scope}: ${row.used}/${row.limit}<div class="mem-bar"><i style="width:${pct}%"></i></div></div>`
    }
    html += '<div class="mem-group">最近审计</div>'
    html += '<div id="mem-audit-slot"><div class="mem-empty">加载中…</div></div>'
    body.insertAdjacentHTML('beforeend', html)
  }

  const renderAudit = (rows) => {
    const slot = document.getElementById('mem-audit-slot')
    if (slot === null) return
    if (!Array.isArray(rows) || rows.length === 0) {
      slot.innerHTML = '<div class="mem-empty">审计为空</div>'
      return
    }
    slot.innerHTML = rows.map((row) =>
      `<div class="mem-audit">${new Date(row.ts).toLocaleString()} ${escapeHtml(row.action)}${row.track ? ` ${escapeHtml(row.track)}/${escapeHtml(row.scope)}` : ''} · ${escapeHtml(row.outcome ?? '')} · ${escapeHtml(row.source ?? '')}</div>`).join('')
  }

  const refresh = async () => {
    try {
      const response = await fetch('/api/memento/entries?limit=200')
      if (!response.ok) throw new Error(`entries ${response.status}`)
      const data = await response.json()
      if (data.error !== undefined) throw new Error(data.error)
      entries = Array.isArray(data.entries) ? data.entries : []
      render()
      renderBudget(data.budgets)
      void fetch('/api/memento/audit?limit=20')
        .then((res) => res.json())
        .then((audit) => renderAudit(audit.rows))
        .catch(() => renderAudit([]))
    } catch (error) {
      body.innerHTML = `<div class="mem-empty">加载失败：${escapeHtml(String(error && error.message ? error.message : error))}（面板只读；请确认 Web profile 已装载 dsh-memento）</div>`
    }
  }

  openBtn.addEventListener('click', () => {
    drawer.style.display = drawer.style.display === 'none' ? 'flex' : 'none'
    if (drawer.style.display !== 'none') void refresh()
  })
  document.getElementById('mem-close').addEventListener('click', () => { drawer.style.display = 'none' })
  document.getElementById('mem-refresh').addEventListener('click', () => void refresh())
  filter.addEventListener('input', () => {
    lastFilter = filter.value
    render()
  })
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
