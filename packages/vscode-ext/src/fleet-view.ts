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
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,.06));
    position: sticky; top: 0; z-index: 10;
    background: var(--vscode-sideBar-background);
  }
  .toolbar label { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
  .toolbar select {
    flex: 1;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 3px;
    padding: 2px 4px;
    cursor: pointer;
  }

  /* ── Group header ── */
  .group-header {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: var(--vscode-sideBarSectionHeader-background, rgba(255,255,255,.04));
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,.06));
    cursor: pointer;
    user-select: none;
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground));
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .group-header:hover { background: var(--vscode-list-hoverBackground); }
  .chevron { font-size: 9px; display: inline-block; transition: transform .12s; }
  .chevron.collapsed { transform: rotate(-90deg); }
  .group-count { margin-left: auto; font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--vscode-descriptionForeground); }

  /* ── Session card ── */
  .session {
    padding: 8px 12px 7px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,.04));
    cursor: default;
  }
  .session:hover { background: var(--vscode-list-hoverBackground); }

  /* Row 1: status pill + goal */
  .session-title { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .status-pill.active       { background: rgba(63,185,80,.15);  color: #3fb950; }
  .status-pill.idle         { background: rgba(210,153,34,.15); color: #d29922; }
  .status-pill.needs-resume { background: rgba(248,81,73,.15);  color: #f85149; }
  .status-pill.completed    { background: rgba(139,148,158,.12);color: #8b949e; }
  .status-pill.dead         { background: rgba(110,118,129,.1); color: #6e7681; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

  .goal {
    flex: 1;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--vscode-foreground);
  }

  /* Row 2: meta info chips */
  .session-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 5px;
    padding-left: 2px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-badge-background, rgba(255,255,255,.06));
    padding: 1px 6px;
    border-radius: 4px;
  }
  .chip.tokens { color: var(--vscode-charts-yellow, #d29922); }

  /* Row 3: actions */
  .session-actions { display: flex; gap: 4px; }
  button {
    font-size: 11px;
    padding: 2px 8px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px;
    cursor: pointer;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }

  .empty { padding: 24px 14px; font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.6; }
</style>
</head>
<body>
<div class="toolbar">
  <label for="groupBy">Group</label>
  <select id="groupBy">
    <option value="none">None</option>
    <option value="activity">Activity</option>
    <option value="status">Status</option>
    <option value="repo">Repo</option>
  </select>
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

  // ── Grouping ──────────────────────────────────────────────────────────────

  const STATUS_ORDER = ['active','idle','needs-resume','completed','dead']
  const STATUS_LABEL = { active:'Active', idle:'Idle', 'needs-resume':'Needs Resume', completed:'Completed', dead:'Dead' }

  // Activity buckets based on lastActivity timestamp
  const ACTIVITY_BUCKETS = [
    { key: 'active-now',   label: 'Active now',     test: ms => (Date.now()-ms) < 5*60*1000 },
    { key: 'today',        label: 'Today',           test: ms => sameDay(ms, 0) },
    { key: 'yesterday',    label: 'Yesterday',       test: ms => sameDay(ms, 1) },
    { key: 'this-week',    label: 'This week',       test: ms => (Date.now()-ms) < 7*86400*1000 },
    { key: 'older',        label: 'Older',           test: ()  => true },
  ]

  function sameDay(ms, daysAgo) {
    const d = new Date(ms), now = new Date()
    const target = new Date(now); target.setDate(now.getDate() - daysAgo)
    return d.getFullYear()===target.getFullYear() && d.getMonth()===target.getMonth() && d.getDate()===target.getDate()
  }

  function groupSessions(list, by) {
    if (by === 'none') return [{ key: null, label: null, items: list }]

    if (by === 'activity') {
      const groups = []
      const assigned = new Set()
      for (const bucket of ACTIVITY_BUCKETS) {
        const items = list.filter(s => !assigned.has(s.id) && bucket.test(s.lastActivity))
        items.forEach(s => assigned.add(s.id))
        if (items.length) groups.push({ key: bucket.key, label: bucket.label, items })
      }
      return groups
    }

    const map = new Map()
    for (const s of list) {
      const key = by === 'status' ? s.status : (s.cwd.split('/').pop() || s.cwd)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    const groups = Array.from(map.entries()).map(([key, items]) => ({
      key, label: by === 'status' ? (STATUS_LABEL[key] || key) : key, items
    }))
    if (by === 'status') groups.sort((a,b) => STATUS_ORDER.indexOf(a.key)-STATUS_ORDER.indexOf(b.key))
    else groups.sort((a,b) => a.label.localeCompare(b.label))
    return groups
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const el = document.getElementById('list')
    if (!sessions.length) {
      el.innerHTML = '<div class="empty">No sessions found.<br>Start a Claude Code session and it will appear here automatically.</div>'
      return
    }

    const groups = groupSessions(sessions, groupBy)
    let html = ''

    for (const g of groups) {
      if (g.key !== null) {
        const c = !!collapsed[g.key]
        html += \`<div class="group-header" data-group="\${esc(g.key)}">
          <span class="chevron\${c?' collapsed':''}">▾</span>
          \${esc(g.label)}
          <span class="group-count">\${g.items.length}</span>
        </div>\`
        if (c) continue
      }
      for (const s of g.items) html += sessionHtml(s)
    }

    el.innerHTML = html

    el.querySelectorAll('.group-header').forEach(h => {
      h.addEventListener('click', () => {
        collapsed[h.dataset.group] = !collapsed[h.dataset.group]
        saveState(); render()
      })
    })
    el.querySelectorAll('button[data-sid]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const s = sessions.find(x => x.id === btn.dataset.sid)
        if (s) send(btn.dataset.action, s)
      })
    })
  }

  function sessionHtml(s) {
    const repo   = s.cwd.split('/').pop() || s.cwd
    const branch = s.gitBranch
    const age    = timeAgo(s.lastActivity)
    const dur    = duration(s.startedAt, s.lastActivity)

    // Status pill
    const pillLabel = { active:'Active', idle:'Idle', 'needs-resume':'Resume', completed:'Done', dead:'Dead' }[s.status] || s.status
    const pill = \`<span class="status-pill \${s.status}"><span class="dot"></span>\${pillLabel}</span>\`

    // Meta chips
    const chips = [
      \`<span class="chip">\${esc(repo)}\${branch ? ' · '+esc(branch) : ''}</span>\`,
      \`<span class="chip">\${esc(age)}</span>\`,
      dur ? \`<span class="chip">\${esc(dur)}</span>\` : '',
      s.tokenUsage ? \`<span class="chip tokens">⬡ \${fmtTokens(s.tokenUsage)}</span>\` : '',
    ].filter(Boolean).join('')

    // Action button
    let btn = ''
    if (s.status === 'active' || s.status === 'idle') {
      btn = \`<button class="primary" data-action="open" data-sid="\${esc(s.id)}">Focus Terminal</button>\`
    } else if (s.status === 'needs-resume') {
      btn = \`<button class="primary" data-action="resume" data-sid="\${esc(s.id)}">Resume</button>\`
    } else {
      btn = \`<button data-action="openFolder" data-sid="\${esc(s.id)}">Open Folder</button>\`
    }

    return \`<div class="session">
      <div class="session-title">
        \${pill}
        <span class="goal" title="\${esc(s.goal)}">\${esc(s.goal)}</span>
      </div>
      <div class="session-meta">\${chips}</div>
      <div class="session-actions">\${btn}</div>
    </div>\`
  }

  function send(action, s) {
    vscode.postMessage({ type: action, sessionId: s.id, cwd: s.cwd, goal: s.goal })
  }

  function esc(s) {
    return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function timeAgo(ms) {
    const d = Date.now() - ms
    if (d < 60000)     return 'just now'
    if (d < 3600000)   return Math.floor(d/60000) + 'm ago'
    if (d < 86400000)  return Math.floor(d/3600000) + 'h ago'
    return Math.floor(d/86400000) + 'd ago'
  }

  function duration(startMs, endMs) {
    const d = endMs - startMs
    if (d < 60000)   return null           // too short to show
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
