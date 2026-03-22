import { execFileSync } from 'node:child_process'

const PREFIX = 'cr-'

function sessionName(name: string): string {
  return `${PREFIX}${name}`
}

/**
 * 建立 detached tmux session，並送出 claude 命令。
 */
export function createSession(name: string, dir: string, claude_name: string): void {
  const session = sessionName(name)
  execFileSync('tmux', ['new-session', '-d', '-s', session, '-c', dir], { stdio: 'pipe' })
  execFileSync('tmux', ['send-keys', '-t', session, `claude --dangerously-skip-permissions --name "${claude_name}"`, 'Enter'], { stdio: 'pipe' })
}

/**
 * 殺掉 tmux session。Session 不存在時不 throw。
 */
export function killSession(name: string): void {
  try {
    execFileSync('tmux', ['kill-session', '-t', sessionName(name)], { stdio: 'pipe' })
  } catch {
    // 靜默處理：session 不存在
  }
}

/**
 * 列出所有 cr- 開頭的 tmux session（回傳去除 prefix 的名稱）。
 * 無 tmux server 時回傳空陣列。
 */
export function listSessions(): string[] {
  try {
    const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { stdio: 'pipe' })
    return output
      .toString()
      .split('\n')
      .filter((line) => line.startsWith(PREFIX))
      .map((line) => line.slice(PREFIX.length))
  } catch {
    return []
  }
}

/**
 * 接上 tmux session（會接管 stdio）。
 * Session 不存在時會 throw。
 */
export function attachSession(name: string): void {
  execFileSync('tmux', ['attach-session', '-t', sessionName(name)], { stdio: 'inherit' })
}

/**
 * 檢查 tmux session 是否存在。
 */
export function sessionExists(name: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName(name)], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}
