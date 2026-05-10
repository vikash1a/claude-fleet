import { EventEmitter } from 'events'
import { readdir, readFile, watch } from 'fs/promises'
import { existsSync, FSWatcher } from 'fs'
import { join, basename } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ClaudeSession, SessionStatus } from './types.js'

const execFileAsync = promisify(execFile)
const PROJECTS_DIR = join(process.env.HOME ?? '/', '.claude', 'projects')

// Each JSONL line from Claude Code looks like this (relevant fields only)
interface JsonlEntry {
  sessionId?: string
  cwd?: string
  type?: string
  message?: { role?: string; content?: unknown }
  timestamp?: string
  costUSD?: number
  usage?: { input_tokens?: number; output_tokens?: number }
}

export class SessionRegistry extends EventEmitter {
  private sessions = new Map<string, ClaudeSession>()
  private watchers: FSWatcher[] = []
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
    // Poll every 5s — simple and reliable
    this.pollTimer = setInterval(() => this.refresh(), 5000)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    for (const w of this.watchers) { try { w.close() } catch {} }
    this.watchers = []
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
          } else if (existing.status !== session.status || existing.lastActivity.getTime() !== session.lastActivity.getTime()) {
            this.emit('session:updated', session)
          }
        } catch {
          // skip unreadable files
        }
      }
    }

    // Remove sessions whose files are gone
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

    for (const line of lines) {
      let entry: JsonlEntry
      try { entry = JSON.parse(line) } catch { continue }

      if (entry.sessionId) sessionId = entry.sessionId
      if (entry.cwd) cwd = entry.cwd
      if (entry.timestamp) {
        const ts = new Date(entry.timestamp)
        if (!startedAt || ts < startedAt) startedAt = ts
        if (!lastActivity || ts > lastActivity) lastActivity = ts
      }

      // First user message = goal
      if (!goal && entry.message?.role === 'user') {
        const content = entry.message.content
        if (typeof content === 'string') goal = content.slice(0, 120)
        else if (Array.isArray(content)) {
          const text = content.find((c: any) => c.type === 'text')?.text
          if (text) goal = String(text).slice(0, 120)
        }
      }

      if (entry.message?.role === 'assistant' && entry.timestamp) {
        lastAssistantTs = new Date(entry.timestamp)
      }
      if (entry.message?.role === 'user' && entry.timestamp) {
        lastUserTs = new Date(entry.timestamp)
      }

      if (entry.usage) {
        totalTokens += (entry.usage.input_tokens ?? 0) + (entry.usage.output_tokens ?? 0)
      }
    }

    if (!sessionId || !cwd) return null

    startedAt    = startedAt    ?? new Date(0)
    lastActivity = lastActivity ?? new Date(0)

    const status = this.deriveStatus(lastAssistantTs, lastUserTs, lastActivity)
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

  private deriveStatus(
    lastAssistant: Date | undefined,
    lastUser: Date | undefined,
    lastActivity: Date
  ): SessionStatus {
    const now = Date.now()
    const idleMs = now - lastActivity.getTime()
    const idleMinutes = idleMs / 60_000

    // If last activity is very recent (< 2 min), likely active
    if (idleMinutes < 2) return 'active'

    // If last message was from user and no assistant reply came after → needs-resume
    if (lastUser && lastAssistant && lastUser > lastAssistant) return 'needs-resume'

    // Idle: assistant replied but nothing in last 10 min
    if (idleMinutes < 60) return 'idle'

    // Dead: nothing for over an hour
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
