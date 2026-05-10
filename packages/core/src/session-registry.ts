import { EventEmitter } from 'events'
import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ClaudeSession, SessionStatus } from './types.js'

const execFileAsync = promisify(execFile)
const PROJECTS_DIR = join(process.env.HOME ?? '/', '.claude', 'projects')

interface JsonlEntry {
  type?: string
  sessionId?: string
  cwd?: string
  timestamp?: string
  isMeta?: boolean
  lastPrompt?: string          // present on 'last-prompt' entries — written when claude exits
  message?: {
    role?: string
    content?: unknown
    stop_reason?: string       // 'end_turn' | 'tool_use'
    usage?: {                  // usage lives inside message, not at top level
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

export class SessionRegistry extends EventEmitter {
  private sessions = new Map<string, ClaudeSession>()
  private pollTimer?: NodeJS.Timeout

  getSessions(): ClaudeSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()
    )
  }

  getSession(id: string): ClaudeSession | undefined {
    return this.sessions.get(id)
  }

  async start(): Promise<void> {
    await this.refresh()
    this.pollTimer = setInterval(() => this.refresh(), 5000)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
  }

  private async refresh(): Promise<void> {
    if (!existsSync(PROJECTS_DIR)) return

    let projectDirs: string[]
    try {
      const entries = await readdir(PROJECTS_DIR, { withFileTypes: true })
      projectDirs = entries.filter(e => e.isDirectory()).map(e => join(PROJECTS_DIR, e.name))
    } catch {
      return
    }

    const seen = new Set<string>()

    for (const dir of projectDirs) {
      let files: string[]
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        files = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => join(dir, e.name))
      } catch {
        continue
      }

      for (const file of files) {
        try {
          const session = await this.parseSessionFile(file)
          if (!session) continue
          seen.add(session.id)

          const existing = this.sessions.get(session.id)
          this.sessions.set(session.id, session)

          if (!existing) {
            this.emit('session:added', session)
          } else if (
            existing.status !== session.status ||
            existing.lastActivity.getTime() !== session.lastActivity.getTime()
          ) {
            this.emit('session:updated', session)
          }
        } catch {
          // skip unreadable files
        }
      }
    }

    for (const [id] of this.sessions) {
      if (!seen.has(id)) {
        const session = this.sessions.get(id)!
        this.sessions.delete(id)
        this.emit('session:removed', session)
      }
    }
  }

  private async parseSessionFile(filePath: string): Promise<ClaudeSession | null> {
    const raw = await readFile(filePath, 'utf8')
    const lines = raw.trim().split('\n').filter(Boolean)
    if (!lines.length) return null

    let sessionId: string | undefined
    let cwd: string | undefined
    let goal: string | undefined
    let startedAt: Date | undefined
    let lastActivity: Date | undefined
    let totalTokens = 0
    let lastAssistantTs: Date | undefined
    let lastUserTs: Date | undefined
    let hasExited = false      // true when a 'last-prompt' entry is found
    let lastStopReason: string | undefined

    for (const line of lines) {
      let entry: JsonlEntry
      try { entry = JSON.parse(line) } catch { continue }

      // Session metadata
      if (entry.sessionId) sessionId = entry.sessionId
      if (entry.cwd) cwd = entry.cwd

      // Timestamps — track earliest (startedAt) and latest (lastActivity)
      if (entry.timestamp) {
        const ts = new Date(entry.timestamp)
        if (!startedAt || ts < startedAt) startedAt = ts
        if (!lastActivity || ts > lastActivity) lastActivity = ts
      }

      // 'last-prompt' is written by Claude Code when it exits cleanly
      if (entry.type === 'last-prompt') {
        hasExited = true
      }

      // First real user message = the goal
      if (!goal && entry.type === 'user' && !entry.isMeta) {
        const content = entry.message?.content
        if (typeof content === 'string') {
          goal = content.trim().slice(0, 120)
        } else if (Array.isArray(content)) {
          const textBlock = content.find((c: any) => c.type === 'text')
          if (textBlock) goal = String(textBlock.text).trim().slice(0, 120)
        }
      }

      // Track last assistant / last user timestamps for needs-resume detection
      if (entry.type === 'assistant' && entry.timestamp) {
        lastAssistantTs = new Date(entry.timestamp)
        lastStopReason = entry.message?.stop_reason
      }
      if (entry.type === 'user' && !entry.isMeta && entry.timestamp) {
        lastUserTs = new Date(entry.timestamp)
      }

      // Token usage lives inside message.usage on assistant entries
      if (entry.type === 'assistant' && entry.message?.usage) {
        const u = entry.message.usage
        totalTokens +=
          (u.input_tokens ?? 0) +
          (u.output_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0)
      }
    }

    if (!sessionId || !cwd) return null

    startedAt    = startedAt    ?? new Date(0)
    lastActivity = lastActivity ?? new Date(0)

    const status = this.deriveStatus({ hasExited, lastAssistantTs, lastUserTs, lastActivity, lastStopReason })
    const gitBranch = await this.getGitBranch(cwd)

    return {
      id: sessionId,
      goal: goal ?? '(no goal)',
      cwd,
      gitBranch,
      startedAt,
      lastActivity,
      tokenUsage: totalTokens || undefined,
      status,
    }
  }

  private deriveStatus(opts: {
    hasExited: boolean
    lastAssistantTs: Date | undefined
    lastUserTs: Date | undefined
    lastActivity: Date
    lastStopReason: string | undefined
  }): SessionStatus {
    const { hasExited, lastAssistantTs, lastUserTs, lastActivity, lastStopReason } = opts
    const idleMs = Date.now() - lastActivity.getTime()
    const idleMinutes = idleMs / 60_000

    // ── Session has exited (last-prompt entry present) ────────────────────────
    if (hasExited) {
      // User sent a message that was never answered → needs to be resumed
      if (lastUserTs && (!lastAssistantTs || lastUserTs > lastAssistantTs)) {
        return 'needs-resume'
      }
      return 'completed'
    }

    // ── Session has not exited (still running or crashed without writing last-prompt) ──

    // Very recent activity → actively processing
    if (idleMinutes < 2) return 'active'

    // Last assistant message ended with tool_use → still mid-turn, just slow
    if (lastStopReason === 'tool_use' && idleMinutes < 10) return 'active'

    // User sent a message with no assistant reply after it → waiting / interrupted
    if (lastUserTs && (!lastAssistantTs || lastUserTs > lastAssistantTs)) {
      // If recent, claude is probably still thinking
      if (idleMinutes < 5) return 'active'
      // If it's been a while with no reply, likely crashed without writing last-prompt
      return 'needs-resume'
    }

    // Assistant replied, session is quiet
    if (idleMinutes < 30) return 'idle'

    // Very old with no exit marker → crashed long ago
    return 'dead'
  }

  private async getGitBranch(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
      return stdout.trim()
    } catch {
      return ''
    }
  }
}
