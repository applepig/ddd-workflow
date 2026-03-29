import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

export const PREFIX = 'cr-'

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
 * 建立 detached tmux session，並送出 claude -y 命令。
 */
export function createSession(session_name: string, dir: string): void {
  execFileSync('tmux', ['new-session', '-d', '-s', session_name, '-c', dir], { stdio: 'pipe' })
  execFileSync('tmux', ['send-keys', '-t', session_name, 'claude --dangerously-skip-permissions', 'Enter'], { stdio: 'pipe' })
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
  const basename = path.basename(path.resolve(dir)) || 'root'
  const base_name = `${PREFIX}${basename}`

  const name_exists = existing.some((s) => s.name === base_name)
  if (!name_exists) {
    return base_name
  }

  const suffix = Date.now().toString(36).slice(-4)
  return `${base_name}-${suffix}`
}
