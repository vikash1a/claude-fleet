export type SessionStatus = 'active' | 'idle' | 'needs-resume' | 'completed' | 'dead'

export interface ClaudeSession {
  id: string
  goal: string
  cwd: string
  gitBranch: string
  startedAt: Date
  lastActivity: Date
  tokenUsage?: number
  status: SessionStatus
}
