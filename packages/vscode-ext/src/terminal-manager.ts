import * as vscode from 'vscode'

export class TerminalManager {
  // Terminals we spawned, keyed by session id
  private terminals = new Map<string, vscode.Terminal>()

  // Focus terminal for an active/idle session.
  // First checks our own map, then falls back to matching any open terminal by cwd.
  // If nothing found, opens a new terminal in the session's cwd.
  focusSession(sessionId: string, cwd: string): void {
    // 1. Terminal we spawned for this session
    const own = this.terminals.get(sessionId)
    if (own) { own.show(); return }

    // 2. Any open terminal whose cwd matches (externally spawned sessions)
    const matched = this.findTerminalByCwd(cwd)
    if (matched) {
      this.terminals.set(sessionId, matched)  // remember it going forward
      matched.show()
      return
    }

    // 3. Nothing found — open a plain terminal in the cwd so the user can at least navigate there
    const term = vscode.window.createTerminal({
      name: `claude · ${cwd.split('/').pop()}`,
      cwd,
    })
    this.terminals.set(sessionId, term)
    term.show()
  }

  // Resume a dead/needs-resume session with `claude --continue`.
  resumeSession(sessionId: string, cwd: string): void {
    const term = vscode.window.createTerminal({
      name: `claude · ${cwd.split('/').pop()}`,
      cwd,
    })
    this.terminals.set(sessionId, term)
    term.show()
    setTimeout(() => term.sendText('claude --continue'), 500)
  }

  // Spawn a brand-new session with a goal.
  spawnSession(sessionId: string, cwd: string, goal: string): void {
    const term = vscode.window.createTerminal({
      name: `claude · ${cwd.split('/').pop()}`,
      cwd,
    })
    this.terminals.set(sessionId, term)
    term.show()
    setTimeout(() => term.sendText(`claude "${goal.replace(/"/g, '\\"')}"`), 500)
  }

  // Open the session folder in the OS file manager.
  openFolder(cwd: string): void {
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(cwd))
  }

  // Clean up closed terminals so the map doesn't leak.
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

  // Find an open terminal whose creation cwd matches the session cwd.
  private findTerminalByCwd(cwd: string): vscode.Terminal | undefined {
    return vscode.window.terminals.find(t => {
      const termCwd = (t.creationOptions as vscode.TerminalOptions).cwd
      if (!termCwd) return false
      const termCwdStr = termCwd instanceof vscode.Uri ? termCwd.fsPath : String(termCwd)
      return termCwdStr === cwd
    })
  }
}
