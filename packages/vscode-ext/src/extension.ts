import * as vscode from 'vscode'
import { SessionRegistry } from '@claude-fleet/core'
import { TerminalManager } from './terminal-manager.js'
import { FleetView } from './fleet-view.js'

export function activate(context: vscode.ExtensionContext): void {
  const registry = new SessionRegistry()
  const terminalManager = new TerminalManager()

  const fleetView = new FleetView(context, terminalManager, (cwd, goal) => {
    const tempId = `new-${Date.now()}`
    terminalManager.spawnSession(tempId, cwd, goal)
  })

  // Register sidebar
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FleetView.viewId, fleetView),
    terminalManager.registerDisposeHandler(),
  )

  // Broadcast session changes to the webview.
  // On session:added also try to link a pending spawned terminal to the real session id.
  registry.on('session:added', (session) => {
    terminalManager.linkSession(session.id, session.cwd, session.goal)
    fleetView.update(registry.getSessions())
  })
  registry.on('session:updated', () => fleetView.update(registry.getSessions()))
  registry.on('session:removed', () => fleetView.update(registry.getSessions()))

  // New session command (+ button in sidebar title)
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeFleet.newSession', async () => {
      const cwd = await vscode.window.showInputBox({
        prompt: 'Working directory for the new session',
        value: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME ?? '/',
        validateInput: v => v.trim() ? undefined : 'Required',
      })
      if (!cwd) return

      const goal = await vscode.window.showInputBox({
        prompt: 'What should Claude work on?',
        placeHolder: 'Describe the task…',
        validateInput: v => v.trim() ? undefined : 'Required',
      })
      if (!goal) return

      const tempId = `new-${Date.now()}`
      terminalManager.spawnSession(tempId, cwd.trim(), goal.trim())
    })
  )

  registry.start()
  context.subscriptions.push({ dispose: () => { registry.stop(); terminalManager.dispose() } })
}

export function deactivate(): void {}
