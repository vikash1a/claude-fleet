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
          this.terminalManager.focusSession(msg.sessionId)
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

  .session {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,.06));
    cursor: pointer;
  }
  .session:hover { background: var(--vscode-list-hoverBackground); }

  .session-top { display: flex; align-items: center; gap: 6px; }
  .dot {
    width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  }
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
  }
  .actions {
    display: flex;
    gap: 4px;
    padding-left: 13px;
    margin-top: 2px;
  }
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

  .empty {
    padding: 20px 12px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
</style>
</head>
<body>
<div id="list"></div>
<script>
  const vscode = acquireVsCodeApi()
  let sessions = ${data}

  function render() {
    const el = document.getElementById('list')
    if (!sessions.length) {
      el.innerHTML = '<div class="empty">No sessions found.<br>Start a Claude Code session to see it here.</div>'
      return
    }
    el.innerHTML = sessions.map(s => {
      const repo = s.cwd.split('/').pop()
      const branch = s.gitBranch ? ' · ' + s.gitBranch : ''
      const tokens = s.tokenUsage ? ' · ' + Math.round(s.tokenUsage / 1000) + 'k tokens' : ''
      const age = timeAgo(s.lastActivity)

      let actions = ''
      if (s.status === 'active' || s.status === 'idle') {
        actions = \`<button class="primary" onclick="send('open',s)">Focus Terminal</button>\`
      } else if (s.status === 'needs-resume') {
        actions = \`<button class="primary" onclick="send('resume',s)">Resume</button>\`
      } else {
        actions = \`<button onclick="send('openFolder',s)">Open Folder</button>\`
      }

      return \`<div class="session">
        <div class="session-top">
          <span class="dot \${s.status}"></span>
          <span class="goal" title="\${esc(s.goal)}">\${esc(s.goal)}</span>
        </div>
        <div class="meta">\${esc(repo)}\${esc(branch)}\${esc(tokens)} · \${esc(age)}</div>
        <div class="actions">\${actions}</div>
      </div>\`
    }).join('')

    // Rebind buttons since we used innerHTML
    document.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const b = e.currentTarget
        const id = b.dataset.id
        const s = sessions.find(x => x.id === id)
        if (s) send(b.dataset.action, s)
      })
    })
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

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'update') { sessions = data.sessions; render() }
  })

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
