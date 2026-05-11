import * as vscode from 'vscode'

interface PendingSpawn {
  term: vscode.Terminal
  cwd: string
  goal: string
}

// Terminal names embed a short session ID so we can re-link after reload.
// Format: "fleet: <repo> [<sessionId-prefix>]"
const NAME_PREFIX = 'fleet:'
const nameFor = (cwd: string, sessionId: string) =>
  `${NAME_PREFIX} ${cwd.split('/').pop()} [${sessionId.slice(0, 7)}]`

// Parse a session ID prefix out of a terminal name we created.
const parseSessionPrefix = (name: string): string | undefined => {
  const m = name.match(/\[([a-f0-9-]{7,})\]$/)
  return m?.[1]
}

export class TerminalManager {
  // Terminals keyed by real session id (UUID from Claude Code)
  private terminals = new Map<string, vscode.Terminal>()

  // Terminals we spawned but not yet linked to a real session id.
  private pending = new Map<string, PendingSpawn>()

  // Called once on activate — re-links terminals that survived a window reload.
  // Walks all open terminals, finds ones we named, matches to sessions by ID prefix.
  relinkAfterReload(sessions: { id: string }[]): void {
    for (const term of vscode.window.terminals) {
      const prefix = parseSessionPrefix(term.name)
      if (!prefix) continue

      const session = sessions.find(s => s.id.startsWith(prefix))
      if (session && !this.terminals.has(session.id)) {
        this.terminals.set(session.id, term)
      }
    }
  }

  // Called by extension.ts when registry fires session:added.
  // Moves a pending terminal into the main map under the real session UUID.
  linkSession(realId: string, cwd: string, goal: string): void {
    if (this.terminals.has(realId)) return

    for (const [tempId, info] of this.pending) {
      if (info.cwd === cwd && info.goal === goal) {
        // Rename the terminal now that we have the real session ID
        this.terminals.set(realId, info.term)
        this.pending.delete(tempId)
        return
      }
    }
  }

  // Returns true if a live terminal is linked to this session.
  hasTerminal(id: string): boolean {
    const term = this.terminals.get(id)
    return term !== undefined && this.isAlive(term)
  }

  // Focus the terminal for an active/idle session.
  focusSession(sessionId: string, cwd: string): void {
    // 1. Terminal linked to this session (spawned or re-linked after reload)
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

    // 3. Can't find it — terminal was tracked but has since closed; offer to resume
    vscode.window.showInformationMessage(
      'Terminal for this session is gone. Resume it?',
      'Resume'
    ).then(choice => {
      if (choice !== 'Resume') return
      const term = vscode.window.createTerminal({ name: nameFor(cwd, sessionId), cwd })
      this.terminals.set(sessionId, term)
      term.show(true)
      setTimeout(() => term.sendText(`claude --resume ${sessionId}`), 500)
    })
  }

  // Resume a needs-resume session with `claude --resume <sessionId>`.
  resumeSession(sessionId: string, cwd: string): void {
    const term = vscode.window.createTerminal({ name: nameFor(cwd, sessionId), cwd })
    this.terminals.set(sessionId, term)
    term.show(true)
    setTimeout(() => term.sendText(`claude --resume ${sessionId}`), 500)
  }

  // Spawn a brand-new session. Stored under tempId until linkSession() fires.
  spawnSession(tempId: string, cwd: string, goal: string): void {
    // Use a placeholder name — renamed conceptually when linkSession() fires
    const term = vscode.window.createTerminal({ name: `${NAME_PREFIX} ${cwd.split('/').pop()} [new]`, cwd })
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
