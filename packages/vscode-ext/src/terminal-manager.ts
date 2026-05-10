import * as vscode from 'vscode'

interface PendingSpawn {
  term: vscode.Terminal
  cwd: string
  goal: string
}

export class TerminalManager {
  // Terminals keyed by real session id (UUID from Claude Code)
  private terminals = new Map<string, vscode.Terminal>()

  // Terminals we spawned but haven't yet linked to a real session id.
  // Keyed by the tempId we assigned at spawn time.
  private pending = new Map<string, PendingSpawn>()

  // Called by extension.ts when registry fires session:added.
  // Tries to link a newly discovered session to a terminal we spawned.
  linkSession(realId: string, cwd: string, goal: string): void {
    // Already linked (e.g. duplicate event)
    if (this.terminals.has(realId)) return

    // Find a pending spawn whose cwd and goal both match.
    // Using both fields avoids the "two sessions same folder" collision.
    for (const [tempId, info] of this.pending) {
      if (info.cwd === cwd && info.goal === goal) {
        this.terminals.set(realId, info.term)
        this.pending.delete(tempId)
        return
      }
    }
  }

  // Focus the terminal for an active/idle session.
  // Priority: linked terminal → shell integration cwd match → creation cwd match → prompt user
  focusSession(sessionId: string, cwd: string): void {
    // 1. Terminal already linked to this session id
    const own = this.terminals.get(sessionId)
    if (own && this.isAlive(own)) {
      own.show(true)
      return
    }

    // 2. Walk open terminals — shellIntegration.cwd first, then creationOptions.cwd
    const match = this.findTerminalByCwd(cwd)
    if (match) {
      this.terminals.set(sessionId, match)
      match.show(true)
      return
    }

    // 3. Can't find it — ask the user
    vscode.window.showInformationMessage(
      'No terminal found for this session. Open one?',
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

  // Resume a needs-resume session with `claude --continue`.
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
  // Stored under a tempId until linkSession() ties it to the real session UUID.
  spawnSession(tempId: string, cwd: string, goal: string): void {
    const term = vscode.window.createTerminal({
      name: `claude · ${cwd.split('/').pop()}`,
      cwd,
    })
    this.pending.set(tempId, { term, cwd, goal })
    term.show(true)
    setTimeout(() => term.sendText(`claude "${goal.replace(/"/g, '\\"')}"`), 500)
  }

  // Open the session folder in the OS file manager.
  openFolder(cwd: string): void {
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(cwd))
  }

  // Clean up closed terminals from both maps.
  registerDisposeHandler(): vscode.Disposable {
    return vscode.window.onDidCloseTerminal(closed => {
      for (const [id, term] of this.terminals) {
        if (term === closed) { this.terminals.delete(id); break }
      }
      for (const [id, info] of this.pending) {
        if (info.term === closed) { this.pending.delete(id); break }
      }
    })
  }

  dispose(): void {
    this.terminals.clear()
    this.pending.clear()
  }

  private isAlive(term: vscode.Terminal): boolean {
    return vscode.window.terminals.includes(term)
  }

  private findTerminalByCwd(cwd: string): vscode.Terminal | undefined {
    const norm = (p: string) => p.replace(/\/+$/, '')
    const target = norm(cwd)

    for (const term of vscode.window.terminals) {
      const siCwd = term.shellIntegration?.cwd
      if (siCwd && norm(siCwd.fsPath) === target) return term

      const creationCwd = (term.creationOptions as vscode.TerminalOptions).cwd
      if (creationCwd) {
        const s = creationCwd instanceof vscode.Uri ? creationCwd.fsPath : String(creationCwd)
        if (norm(s) === target) return term
      }
    }

    return undefined
  }
}
