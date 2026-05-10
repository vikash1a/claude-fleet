import * as vscode from 'vscode'

export class TerminalManager {
  // Terminals we spawned, keyed by session id
  private terminals = new Map<string, vscode.Terminal>()

  // Focus the terminal for an active/idle session.
  // Priority: spawned terminal → shell integration cwd match → creation options cwd match → notify user
  focusSession(sessionId: string, cwd: string): void {
    // 1. Terminal we spawned for this session — most reliable
    const own = this.terminals.get(sessionId)
    if (own && this.isAlive(own)) {
      own.show(true)
      return
    }

    // 2. Walk all open terminals, prefer shellIntegration.cwd (accurate current dir),
    //    fall back to creationOptions.cwd (creation-time dir)
    const match = this.findTerminalByCwd(cwd)
    if (match) {
      this.terminals.set(sessionId, match)
      match.show(true)
      return
    }

    // 3. Nothing found — tell the user rather than silently opening a wrong terminal
    vscode.window.showInformationMessage(
      `No terminal found for this session. Open one?`,
      'Open Terminal'
    ).then(choice => {
      if (choice !== 'Open Terminal') return
      const term = vscode.window.createTerminal({
        name: `claude · ${cwd.split('/').pop()}`,
        cwd,
      })
      this.terminals.set(sessionId, term)
      term.show(true)
    })
  }

  // Resume a dead/needs-resume session with `claude --continue`.
  resumeSession(sessionId: string, cwd: string): void {
    const term = vscode.window.createTerminal({
      name: `claude · ${cwd.split('/').pop()}`,
      cwd,
    })
    this.terminals.set(sessionId, term)
    term.show(true)
    setTimeout(() => term.sendText('claude --continue'), 500)
  }

  // Spawn a brand-new session with a goal.
  spawnSession(sessionId: string, cwd: string, goal: string): void {
    const term = vscode.window.createTerminal({
      name: `claude · ${cwd.split('/').pop()}`,
      cwd,
    })
    this.terminals.set(sessionId, term)
    term.show(true)
    setTimeout(() => term.sendText(`claude "${goal.replace(/"/g, '\\"')}"`), 500)
  }

  // Open the session folder in the OS file manager.
  openFolder(cwd: string): void {
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(cwd))
  }

  // Clean up closed terminals from the map.
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

  // Check if a terminal is still open (not disposed/closed)
  private isAlive(term: vscode.Terminal): boolean {
    return vscode.window.terminals.includes(term)
  }

  // Find an open terminal whose cwd matches, checking shell integration first.
  private findTerminalByCwd(cwd: string): vscode.Terminal | undefined {
    const normalise = (p: string) => p.replace(/\/+$/, '')  // strip trailing slash
    const target = normalise(cwd)

    for (const term of vscode.window.terminals) {
      // Shell integration gives the most accurate cwd (updated at each prompt)
      const siCwd = term.shellIntegration?.cwd
      if (siCwd) {
        if (normalise(siCwd.fsPath) === target) return term
      }

      // Fall back to the cwd the terminal was created with
      const creationCwd = (term.creationOptions as vscode.TerminalOptions).cwd
      if (creationCwd) {
        const creationStr = creationCwd instanceof vscode.Uri
          ? creationCwd.fsPath
          : String(creationCwd)
        if (normalise(creationStr) === target) return term
      }
    }

    return undefined
  }
}
