import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'

export const PREFIX = 'cr-'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Session 資訊 */
export interface SessionInfo {
  name: string
  dir: string
}

/**
 * 列出所有 cr- 開頭的 tmux session，包含名稱與工作目錄。
 * 無 tmux server 時回傳空陣列。
 */
export function listSessions(): SessionInfo[] {
  try {
    const output = execFileSync(
      'tmux',
      ['list-sessions', '-F', '#{session_name}:#{pane_current_path}'],
      { stdio: 'pipe' },
    )
    return output
      .toString()
      .split('\n')
      .filter((line) => line.startsWith(PREFIX))
      .map((line) => {
        const colon_idx = line.indexOf(':')
        if (colon_idx === -1) {
          return { name: line, dir: '' }
        }
        return {
          name: line.slice(0, colon_idx),
          dir: line.slice(colon_idx + 1),
        }
      })
  } catch {
    return []
  }
}

/**
 * 內部 helper：建立 detached tmux session、設定 environment、送出 claude 命令。
 */
function startTmuxSession(session_name: string, dir: string, claude_session_id: string, claude_cmd: string): void {
  execFileSync('tmux', ['new-session', '-d', '-s', session_name, '-c', dir], { stdio: 'pipe' })
  execFileSync('tmux', ['set-environment', '-t', session_name, 'CLAUDE_SESSION_ID', claude_session_id], { stdio: 'pipe' })
  execFileSync('tmux', ['send-keys', '-t', session_name, claude_cmd, 'Enter'], { stdio: 'pipe' })
}

/**
 * 建立 detached tmux session，產生 UUID 作為 Claude session ID，
 * 存入 tmux environment 並以 --session-id 啟動 claude。
 */
export function createSession(session_name: string, dir: string): void {
  const claude_session_id = randomUUID()
  startTmuxSession(session_name, dir, claude_session_id, `claude --session-id ${claude_session_id} --dangerously-skip-permissions`)
}

/**
 * 從 tmux environment 讀取 CLAUDE_SESSION_ID。
 * 找不到時回傳 null。
 */
export function getClaudeSessionId(session_name: string): string | null {
  try {
    const output = execFileSync(
      'tmux',
      ['show-environment', '-t', session_name, 'CLAUDE_SESSION_ID'],
      { stdio: 'pipe' },
    )
    const line = output.toString().trim()
    const eq_idx = line.indexOf('=')
    if (eq_idx === -1) return null
    const value = line.slice(eq_idx + 1)
    if (!value || !UUID_RE.test(value)) return null
    return value
  } catch {
    return null
  }
}

/**
 * 建立 detached tmux session，用 --resume 恢復既有 Claude Code 對話。
 * claude_session_id 會存入 tmux environment 以利後續再次 resume。
 */
export function createSessionWithResume(session_name: string, dir: string, claude_session_id: string): void {
  startTmuxSession(session_name, dir, claude_session_id, `claude --resume ${claude_session_id} --dangerously-skip-permissions`)
}

/**
 * 終止指定的 tmux session。
 */
export function killSession(session_name: string): void {
  execFileSync('tmux', ['kill-session', '-t', session_name], { stdio: 'pipe' })
}

/**
 * 接上 tmux session（會接管 stdio）。
 */
export function attachSession(session_name: string): void {
  execFileSync('tmux', ['attach-session', '-t', session_name], { stdio: 'inherit' })
}

/**
 * 產生 session 名稱：cr-<basename>，若同名已存在則加 suffix。
 */
export function generateSessionName(dir: string, existing: SessionInfo[]): string {
  const raw_basename = path.basename(path.resolve(dir)) || 'root'
  const sanitized = raw_basename.replace(/\./g, '_')
  const base_name = `${PREFIX}${sanitized}`

  const name_exists = existing.some((s) => s.name === base_name)
  if (!name_exists) {
    return base_name
  }

  const suffix = Date.now().toString(36).slice(-4)
  return `${base_name}-${suffix}`
}
