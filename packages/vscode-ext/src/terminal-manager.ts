import * as vscode from 'vscode'

export class TerminalManager {
  // Track terminals we spawned, keyed by session id
  private terminals = new Map<string, vscode.Terminal>()

  // Step 1: Focus an existing terminal for an active/idle session.
  // Returns false if no terminal is tracked for this session.
  focusSession(sessionId: string): boolean {
    const term = this.terminals.get(sessionId)
    if (!term) return false
    term.show()
    return true
  }

  // Step 2: Resume a dead/needs-resume session with `claude --continue`.
  resumeSession(sessionId: string, cwd: string): void {
    const term = vscode.window.createTerminal({
      name: `claude · ${cwd.split('/').pop()}`,
      cwd,
    })
    this.terminals.set(sessionId, term)
    term.show()
    // Small delay so the shell is ready before we send the command
    setTimeout(() => term.sendText('claude --continue'), 500)
  }

  // Step 3: Spawn a brand-new session with a goal.
  spawnSession(sessionId: string, cwd: string, goal: string): void {
    const term = vscode.window.createTerminal({
      name: `claude · ${cwd.split('/').pop()}`,
      cwd,
    })
    this.terminals.set(sessionId, term)
    term.show()
    setTimeout(() => term.sendText(`claude "${goal.replace(/"/g, '\\"')}"`), 500)
  }

  // Step 4: Open the session folder in VS Code explorer.
  openFolder(cwd: string): void {
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(cwd))
  }

  // Clean up closed terminals so the map doesn't leak
  registerDisposeHandler(): vscode.Disposable {
    return vscode.window.onDidCloseTerminal(closed => {
      for (const [id, term] of this.terminals) {
        if (term === closed) { this.terminals.delete(id); break }
      }
    })
  }

  dispose(): void {
    this.terminals.clear()
  }
}
