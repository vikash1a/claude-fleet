import * as vscode from 'vscode'
import { SessionRegistry } from '@claude-fleet/core'
import { TerminalManager } from './terminal-manager.js'
import { FleetView } from './fleet-view.js'

export function activate(context: vscode.ExtensionContext): void {
  const registry = new SessionRegistry()
  const terminalManager = new TerminalManager()

  // ── Status bar badge ───────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  statusBar.command = 'workbench.view.extension.claude-fleet'
  statusBar.tooltip = 'Claude Fleet — click to open'
  statusBar.show()
  context.subscriptions.push(statusBar)

  function updateStatusBar(): void {
    const sessions = registry.getSessions()
    const active = sessions.filter(s => s.status === 'active').length
    const needsResume = sessions.filter(s => s.status === 'needs-resume').length
    const total = sessions.length

    if (total === 0) {
      statusBar.text = '$(circuit-board) Fleet'
      statusBar.backgroundColor = undefined
      return
    }

    if (needsResume > 0) {
      statusBar.text = `$(circuit-board) ${active} active · ${needsResume} need resume`
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
    } else {
      statusBar.text = `$(circuit-board) ${active}/${total} active`
      statusBar.backgroundColor = undefined
    }
  }

  const fleetView = new FleetView(context, terminalManager, (cwd, goal) => {
    const tempId = `new-${Date.now()}`
    terminalManager.spawnSession(tempId, cwd, goal)
  })

  // Register sidebar
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FleetView.viewId, fleetView),
    terminalManager.registerDisposeHandler(),
  )

  const hasTerminal = (id: string) => terminalManager.hasTerminal(id)

  // Broadcast session changes to the webview + update status bar
  registry.on('session:added', (session) => {
    terminalManager.linkSession(session.id, session.cwd, session.goal)
    fleetView.update(registry.getSessions(), hasTerminal)
    updateStatusBar()
  })
  registry.on('session:updated', () => {
    fleetView.update(registry.getSessions(), hasTerminal)
    updateStatusBar()
  })
  registry.on('session:removed', () => {
    fleetView.update(registry.getSessions(), hasTerminal)
    updateStatusBar()
  })

  // ── New session command ────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeFleet.newSession', async () => {
      // Build cwd quick-pick: workspace folders first, then recently used cwds from sessions
      const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => ({
        label: f.name,
        description: f.uri.fsPath,
        fsPath: f.uri.fsPath,
      }))

      const recentCwds = [...new Set(
        registry.getSessions().map(s => s.cwd).filter(c => !workspaceFolders.some(f => f.fsPath === c))
      )].slice(0, 5).map(c => ({
        label: c.split('/').pop() ?? c,
        description: c,
        fsPath: c,
      }))

      const customOption = { label: '$(folder) Enter path manually…', description: '', fsPath: '__custom__' }

      const cwdPick = await vscode.window.showQuickPick(
        [...workspaceFolders, ...recentCwds, customOption],
        { title: 'New Claude Session — Working Directory', placeHolder: 'Select a folder' }
      )
      if (!cwdPick) return

      let cwd: string
      if (cwdPick.fsPath === '__custom__') {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter the working directory path',
          value: process.env.HOME ?? '/',
          validateInput: v => v.trim() ? undefined : 'Required',
        })
        if (!input) return
        cwd = input.trim()
      } else {
        cwd = cwdPick.fsPath
      }

      const goal = await vscode.window.showInputBox({
        title: 'New Claude Session — Goal',
        prompt: 'What should Claude work on?',
        placeHolder: 'Describe the task…',
        validateInput: v => v.trim() ? undefined : 'Required',
      })
      if (!goal) return

      const tempId = `new-${Date.now()}`
      terminalManager.spawnSession(tempId, cwd, goal.trim())
    })
  )

  registry.start().then(() => {
    // Re-link terminals that survived the window reload by scanning their names,
    // then push a fresh update so the webview reflects correct hasTerminal state.
    terminalManager.relinkAfterReload(registry.getSessions())
    fleetView.update(registry.getSessions(), hasTerminal)
    updateStatusBar()
  })
  context.subscriptions.push({ dispose: () => { registry.stop(); terminalManager.dispose() } })
}

export function deactivate(): void {}
