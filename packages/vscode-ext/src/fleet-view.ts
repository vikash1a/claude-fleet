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
        case 'open':
          this.terminalManager.focusSession(msg.sessionId, msg.cwd)
          break
        case 'resume':
          this.terminalManager.resumeSession(msg.sessionId, msg.cwd)
          break
        case 'openFolder':
          this.terminalManager.openFolder(msg.cwd)
          break
        case 'newSession':
          this.onNewSession(msg.cwd, msg.goal)
          break
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
    padding: 0;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,.06));
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
    color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .group-header:hover { background: var(--vscode-list-hoverBackground); }
  .chevron { font-size: 10px; transition: transform .15s; display: inline-block; }
  .chevron.collapsed { transform: rotate(-90deg); }
  .group-count {
    margin-left: auto;
    font-size: 10px;
    font-weight: 400;
    color: var(--vscode-descriptionForeground);
    text-transform: none;
    letter-spacing: 0;
  }

  /* ── Session row ── */
  .session {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,.04));
    cursor: default;
  }
  .session:hover { background: var(--vscode-list-hoverBackground); }
  .session-top { display: flex; align-items: center; gap: 6px; }

  .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .dot.active       { background: #3fb950; }
  .dot.idle         { background: #d29922; }
  .dot.needs-resume { background: #f85149; }
  .dot.completed    { background: #8b949e; }
  .dot.dead         { background: #6e7681; }

  .goal {
    flex: 1;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--vscode-foreground);
  }
  .meta {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    padding-left: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .actions { display: flex; gap: 4px; padding-left: 13px; margin-top: 2px; }

  button {
    font-size: 11px;
    padding: 1px 7px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px;
    cursor: pointer;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }

  .empty { padding: 20px 12px; font-size: 12px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div class="toolbar">
  <label for="groupBy">Group by</label>
  <select id="groupBy">
    <option value="none">None</option>
    <option value="status">Status</option>
    <option value="repo">Repo</option>
  </select>
</div>
<div id="list"></div>

<script>
  const vscode = acquireVsCodeApi()

  // Restore persisted state
  const state = vscode.getState() || {}
  let groupBy = state.groupBy || 'none'
  let collapsed = state.collapsed || {}   // { [groupKey]: true }
  let sessions = ${data}

  // Restore groupBy selector
  document.getElementById('groupBy').value = groupBy
  document.getElementById('groupBy').addEventListener('change', e => {
    groupBy = e.target.value
    saveState()
    render()
  })

  // ── Grouping helpers ──────────────────────────────────────────────────────

  const STATUS_ORDER = ['active', 'idle', 'needs-resume', 'completed', 'dead']
  const STATUS_LABEL = {
    active: 'Active', idle: 'Idle', 'needs-resume': 'Needs Resume',
    completed: 'Completed', dead: 'Dead'
  }

  function groupSessions(sessions, by) {
    if (by === 'none') return [{ key: null, label: null, items: sessions }]

    const map = new Map()
    for (const s of sessions) {
      const key = by === 'status' ? s.status : (s.cwd.split('/').pop() || s.cwd)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }

    const groups = Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: by === 'status' ? (STATUS_LABEL[key] || key) : key,
      items,
    }))

    // Sort groups: status uses fixed order, repo uses alpha
    if (by === 'status') {
      groups.sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key))
    } else {
      groups.sort((a, b) => a.label.localeCompare(b.label))
    }

    return groups
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const el = document.getElementById('list')
    if (!sessions.length) {
      el.innerHTML = '<div class="empty">No sessions found.<br>Start a Claude Code session to see it here.</div>'
      return
    }

    const groups = groupSessions(sessions, groupBy)
    let html = ''

    for (const group of groups) {
      if (group.key !== null) {
        const isCollapsed = !!collapsed[group.key]
        html += \`<div class="group-header" data-group="\${esc(group.key)}">
          <span class="chevron\${isCollapsed ? ' collapsed' : ''}">▾</span>
          \${esc(group.label)}
          <span class="group-count">\${group.items.length}</span>
        </div>\`
        if (isCollapsed) continue
      }

      for (const s of group.items) {
        html += sessionHtml(s)
      }
    }

    el.innerHTML = html

    // Group header click → toggle collapse
    el.querySelectorAll('.group-header').forEach(h => {
      h.addEventListener('click', () => {
        const key = h.dataset.group
        collapsed[key] = !collapsed[key]
        saveState()
        render()
      })
    })

    // Action button clicks
    el.querySelectorAll('button[data-sid]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const s = sessions.find(x => x.id === btn.dataset.sid)
        if (s) send(btn.dataset.action, s)
      })
    })
  }

  function sessionHtml(s) {
    const repo = s.cwd.split('/').pop() || s.cwd
    const branch = s.gitBranch ? ' · ' + s.gitBranch : ''
    const tokens = s.tokenUsage ? ' · ' + fmtTokens(s.tokenUsage) : ''
    const age = timeAgo(s.lastActivity)

    let btnHtml = ''
    if (s.status === 'active' || s.status === 'idle') {
      btnHtml = \`<button class="primary" data-action="open" data-sid="\${esc(s.id)}">Focus Terminal</button>\`
    } else if (s.status === 'needs-resume') {
      btnHtml = \`<button class="primary" data-action="resume" data-sid="\${esc(s.id)}">Resume</button>\`
    } else {
      btnHtml = \`<button data-action="openFolder" data-sid="\${esc(s.id)}">Open Folder</button>\`
    }

    return \`<div class="session">
      <div class="session-top">
        <span class="dot \${s.status}"></span>
        <span class="goal" title="\${esc(s.goal)}">\${esc(s.goal)}</span>
      </div>
      <div class="meta">\${esc(repo)}\${esc(branch)}\${esc(tokens)} · \${esc(age)}</div>
      <div class="actions">\${btnHtml}</div>
    </div>\`
  }

  function send(action, s) {
    vscode.postMessage({ type: action, sessionId: s.id, cwd: s.cwd, goal: s.goal })
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function timeAgo(ms) {
    const diff = Date.now() - ms
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return Math.floor(diff/60000) + 'm ago'
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago'
    return Math.floor(diff/86400000) + 'd ago'
  }

  function fmtTokens(n) {
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M tok'
    if (n >= 1000) return Math.round(n/1000) + 'k tok'
    return n + ' tok'
  }

  function saveState() {
    vscode.setState({ groupBy, collapsed })
  }

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'update') { sessions = data.sessions; render() }
  })

  // Refresh timestamps every 30s without a full re-render from the server
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
