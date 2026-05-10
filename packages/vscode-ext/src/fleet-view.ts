import * as vscode from 'vscode'
import type { ClaudeSession } from '@claude-fleet/core'
import type { TerminalManager } from './terminal-manager.js'

export class FleetView implements vscode.WebviewViewProvider {
  public static readonly viewId = 'claudeFleet.sidebar'
  private view?: vscode.WebviewView

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly terminalManager: TerminalManager,
    private readonly onNewSession: (cwd: string, goal: string) => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = this.getHtml([])

    webviewView.webview.onDidReceiveMessage(msg => {
      switch (msg.type) {
        case 'open':       this.terminalManager.focusSession(msg.sessionId, msg.cwd); break
        case 'resume':     this.terminalManager.resumeSession(msg.sessionId, msg.cwd); break
        case 'openFolder': this.terminalManager.openFolder(msg.cwd); break
        case 'newSession': this.onNewSession(msg.cwd, msg.goal); break
        case 'runNewSessionCommand':
          vscode.commands.executeCommand('claudeFleet.newSession'); break
      }
    })
  }

  update(sessions: ClaudeSession[]): void {
    if (!this.view) return
    this.view.webview.postMessage({ type: 'update', sessions: sessions.map(serialize) })
  }

  private getHtml(initial: ClaudeSession[]): string {
    const data = JSON.stringify(initial.map(serialize))
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,.06));
    flex-shrink: 0;
  }
  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .toolbar-group select {
    font-size: 11px;
    font-family: var(--vscode-font-family);
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 3px;
    padding: 1px 3px;
    cursor: pointer;
  }
  .btn-new {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 8px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px;
    cursor: pointer;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .btn-new:hover { background: var(--vscode-button-hoverBackground); }

  /* ── Scrollable list ── */
  #list { flex: 1; overflow-y: auto; }

  /* ── Group header ── */
  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--vscode-sideBarSectionHeader-background, rgba(255,255,255,.03));
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,.05));
    cursor: pointer;
    user-select: none;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground));
  }
  .group-header:hover { background: var(--vscode-list-hoverBackground); }
  .chevron {
    width: 12px; height: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; flex-shrink: 0;
    transition: transform .15s ease;
    color: var(--vscode-descriptionForeground);
  }
  .chevron.open  { transform: rotate(90deg); }
  .group-label { flex: 1; }
  .group-count {
    font-size: 10px;
    font-weight: 500;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--vscode-badge-background, rgba(255,255,255,.08));
    color: var(--vscode-badge-foreground, var(--vscode-descriptionForeground));
    text-transform: none;
    letter-spacing: 0;
    min-width: 18px;
    text-align: center;
  }

  /* ── Session card ── */
  .session {
    padding: 6px 10px 6px 12px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,.04));
  }
  .session:hover { background: var(--vscode-list-hoverBackground); }
  .session:hover .action-btn { opacity: 1; }

  /* Row 1: goal + action button */
  .session-row1 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
  }
  .goal {
    flex: 1;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--vscode-foreground);
  }
  .action-btn {
    flex-shrink: 0;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    border: 1px solid var(--vscode-button-border, transparent);
    opacity: 0;
    transition: opacity .1s;
    white-space: nowrap;
  }
  .action-btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .action-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  .action-btn.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .action-btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* Row 2: chips */
  .session-row2 {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .chip {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-badge-background, rgba(255,255,255,.05));
    padding: 0px 5px;
    border-radius: 3px;
  }
  .chip.tok { color: var(--vscode-charts-yellow, #c0a030); }
  .chip.status-active       { color: #3fb950; }
  .chip.status-idle         { color: #d29922; }
  .chip.status-needs-resume { color: #f85149; }

  .empty {
    padding: 24px 14px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.7;
  }
</style>
</head>
<body>

<div class="toolbar">
  <div class="toolbar-group">
    <span>Group</span>
    <select id="groupBy">
      <option value="none">None</option>
      <option value="activity">Activity</option>
      <option value="status">Status</option>
      <option value="repo">Repo</option>
    </select>
  </div>
  <button class="btn-new" id="btnNew">+ New Session</button>
</div>

<div id="list"></div>

<script>
  const vscode = acquireVsCodeApi()
  const state = vscode.getState() || {}
  let groupBy   = state.groupBy  || 'none'
  let collapsed = state.collapsed || {}
  let sessions  = ${data}

  document.getElementById('groupBy').value = groupBy
  document.getElementById('groupBy').addEventListener('change', e => {
    groupBy = e.target.value; saveState(); render()
  })
  document.getElementById('btnNew').addEventListener('click', () => {
    vscode.postMessage({ type: 'runNewSessionCommand' })
  })

  // ── Grouping ──────────────────────────────────────────────────────────────

  const STATUS_ORDER = ['active','idle','needs-resume','completed','dead']
  const STATUS_LABEL = { active:'Active', idle:'Idle', 'needs-resume':'Needs Resume', completed:'Completed', dead:'Dead' }

  const ACTIVITY_BUCKETS = [
    { key:'now',       label:'Active now',  test: ms => (Date.now()-ms) < 5*60*1000 },
    { key:'today',     label:'Today',       test: ms => sameDay(ms,0) },
    { key:'yesterday', label:'Yesterday',   test: ms => sameDay(ms,1) },
    { key:'week',      label:'This week',   test: ms => (Date.now()-ms) < 7*86400*1000 },
    { key:'older',     label:'Older',       test: ()  => true },
  ]

  function sameDay(ms, ago) {
    const d = new Date(ms), t = new Date()
    t.setDate(t.getDate() - ago)
    return d.getFullYear()===t.getFullYear() && d.getMonth()===t.getMonth() && d.getDate()===t.getDate()
  }

  function groupSessions(list, by) {
    if (by === 'none') return [{ key: null, label: null, items: list }]

    if (by === 'activity') {
      const seen = new Set(), groups = []
      for (const b of ACTIVITY_BUCKETS) {
        const items = list.filter(s => !seen.has(s.id) && b.test(s.lastActivity))
        items.forEach(s => seen.add(s.id))
        if (items.length) groups.push({ key: b.key, label: b.label, items })
      }
      return groups
    }

    const map = new Map()
    for (const s of list) {
      const k = by === 'status' ? s.status : (s.cwd.split('/').pop() || s.cwd)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(s)
    }
    const groups = [...map.entries()].map(([k,items]) => ({
      key: k, label: by==='status' ? (STATUS_LABEL[k]||k) : k, items
    }))
    if (by==='status') groups.sort((a,b) => STATUS_ORDER.indexOf(a.key)-STATUS_ORDER.indexOf(b.key))
    else groups.sort((a,b) => a.label.localeCompare(b.label))
    return groups
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const el = document.getElementById('list')
    if (!sessions.length) {
      el.innerHTML = '<div class="empty">No sessions yet.<br>Click <b>+ New Session</b> to start one,<br>or run Claude Code in any terminal.</div>'
      return
    }

    const groups = groupSessions(sessions, groupBy)
    let html = ''

    for (const g of groups) {
      if (g.key !== null) {
        const open = !collapsed[g.key]
        html += \`<div class="group-header" data-group="\${esc(g.key)}">
          <span class="chevron \${open?'open':''}">›</span>
          <span class="group-label">\${esc(g.label)}</span>
          <span class="group-count">\${g.items.length}</span>
        </div>\`
        if (!open) continue
      }
      for (const s of g.items) html += cardHtml(s)
    }

    el.innerHTML = html

    el.querySelectorAll('.group-header').forEach(h => {
      h.addEventListener('click', () => {
        const k = h.dataset.group
        collapsed[k] = !collapsed[k]
        saveState(); render()
      })
    })

    el.querySelectorAll('.action-btn[data-sid]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const s = sessions.find(x => x.id === btn.dataset.sid)
        if (s) vscode.postMessage({ type: btn.dataset.action, sessionId: s.id, cwd: s.cwd, goal: s.goal })
      })
    })
  }

  function cardHtml(s) {
    const repo   = s.cwd.split('/').pop() || s.cwd
    const branch = s.gitBranch
    const age    = timeAgo(s.lastActivity)
    const dur    = duration(s.startedAt, s.lastActivity)

    // Action button — top right, visible on hover
    let action = '', actionClass = 'secondary'
    if (s.status === 'active' || s.status === 'idle') {
      action = 'Focus'; actionClass = 'primary'
    } else if (s.status === 'needs-resume') {
      action = 'Resume'; actionClass = 'primary'
    } else {
      action = 'Open Folder'
    }
    const actionType = s.status==='active'||s.status==='idle' ? 'open'
                     : s.status==='needs-resume' ? 'resume' : 'openFolder'

    const btn = \`<button class="action-btn \${actionClass}" data-action="\${actionType}" data-sid="\${esc(s.id)}">\${action}</button>\`

    // Status chip only for states that need attention
    let statusChip = ''
    if (s.status === 'needs-resume') statusChip = \`<span class="chip status-needs-resume">needs resume</span>\`
    else if (s.status === 'active')  statusChip = \`<span class="chip status-active">active</span>\`

    const repoChip  = \`<span class="chip">\${esc(repo)}\${branch?' · '+esc(branch):''}</span>\`
    const ageChip   = \`<span class="chip">\${esc(age)}</span>\`
    const durChip   = dur ? \`<span class="chip">\${esc(dur)}</span>\` : ''
    const tokChip   = s.tokenUsage ? \`<span class="chip tok">⬡ \${fmtTokens(s.tokenUsage)}</span>\` : ''

    return \`<div class="session">
      <div class="session-row1">
        <span class="goal" title="\${esc(s.goal)}">\${esc(s.goal)}</span>
        \${btn}
      </div>
      <div class="session-row2">\${repoChip}\${ageChip}\${durChip}\${tokChip}\${statusChip}</div>
    </div>\`
  }

  function esc(s) {
    return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function timeAgo(ms) {
    const d = Date.now() - ms
    if (d < 60000)    return 'just now'
    if (d < 3600000)  return Math.floor(d/60000) + 'm ago'
    if (d < 86400000) return Math.floor(d/3600000) + 'h ago'
    return Math.floor(d/86400000) + 'd ago'
  }

  function duration(startMs, endMs) {
    const d = endMs - startMs
    if (d < 60000)   return null
    if (d < 3600000) return Math.floor(d/60000) + 'm'
    return (d/3600000).toFixed(1) + 'h'
  }

  function fmtTokens(n) {
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M'
    if (n >= 1000)    return Math.round(n/1000) + 'k'
    return String(n)
  }

  function saveState() { vscode.setState({ groupBy, collapsed }) }

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'update') { sessions = data.sessions; render() }
  })

  setInterval(() => render(), 30000)
  render()
</script>
</body>
</html>`
  }
}

function serialize(s: ClaudeSession) {
  return {
    id: s.id,
    goal: s.goal,
    cwd: s.cwd,
    gitBranch: s.gitBranch,
    status: s.status,
    lastActivity: s.lastActivity.getTime(),
    startedAt: s.startedAt.getTime(),
    tokenUsage: s.tokenUsage ?? null,
  }
}
