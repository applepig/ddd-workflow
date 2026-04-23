#!/usr/bin/env tsx

import * as os from 'node:os'
import { listSessions, attachSession, createSession, createSessionWithResume, getClaudeSessionId, killSession, generateSessionName, syncSessionId, sessionFileExists } from './tmux.ts'
import type { SessionInfo } from './tmux.ts'

/** 選單狀態 */
export interface MenuState {
  selected: number
  total: number
}

/** 選單動作 */
export type MenuAction =
  | { type: 'attach'; session_name: string }
  | { type: 'create'; dir: string }
  | { type: 'terminate'; session_name: string }
  | { type: 'restart'; session_name: string; dir: string }
  | { type: 'move'; selected: number }
  | { type: 'quit' }
  | { type: 'none' }

/**
 * 將絕對路徑中的 home 目錄替換為 ~。
 */
export function shortenDir(dir: string): string {
  const home = os.homedir()
  if (dir === home) return '~'
  if (dir.startsWith(home + '/')) {
    return '~' + dir.slice(home.length)
  }
  return dir
}

/**
 * 渲染選單字串（純函式）。
 */
export function renderMenu(
  sessions: SessionInfo[],
  cwd: string,
  selected: number,
): string {
  const lines: string[] = []

  lines.push('')
  lines.push('  Claude Code Sessions')
  lines.push('')

  sessions.forEach((session, i) => {
    const marker = selected === i ? '>' : ' '
    const num = i + 1
    const dir_display = shortenDir(session.dir)
    lines.push(`${marker} [${num}] ● ${session.name}       ${dir_display}`)
  })

  if (sessions.length > 0) {
    lines.push('')
  }

  const new_idx = sessions.length
  const new_marker = selected === new_idx ? '>' : ' '
  const new_num = new_idx + 1
  const cwd_display = shortenDir(cwd)
  lines.push(`${new_marker} [${new_num}] ○ Start new session here (${cwd_display})`)

  lines.push('')
  lines.push('  ↑↓/數字 選擇  Enter 連線  x 終止  r 重啟  q 離開')
  lines.push('')

  return lines.join('\n')
}

/**
 * 處理按鍵輸入，回傳動作（純函式）。
 */
export function handleInput(
  key: string,
  state: MenuState,
  sessions: SessionInfo[],
  cwd: string,
): MenuAction {
  // Quit
  if (key === 'q' || key === 'CTRL_C') {
    return { type: 'quit' }
  }

  // Number keys
  const num = parseInt(key, 10)
  if (num >= 1 && num <= state.total) {
    const idx = num - 1
    if (idx < sessions.length) {
      return { type: 'attach', session_name: sessions[idx].name }
    }
    return { type: 'create', dir: cwd }
  }

  // Arrow keys
  if (key === 'DOWN') {
    const next = (state.selected + 1) % state.total
    return { type: 'move', selected: next }
  }
  if (key === 'UP') {
    const prev = (state.selected - 1 + state.total) % state.total
    return { type: 'move', selected: prev }
  }

  // Terminate
  if (key === 'x') {
    if (state.selected < sessions.length) {
      return { type: 'terminate', session_name: sessions[state.selected].name }
    }
    return { type: 'none' }
  }

  // Restart
  if (key === 'r') {
    if (state.selected < sessions.length) {
      return {
        type: 'restart',
        session_name: sessions[state.selected].name,
        dir: sessions[state.selected].dir,
      }
    }
    return { type: 'none' }
  }

  // Enter
  if (key === 'ENTER') {
    if (state.selected < sessions.length) {
      return { type: 'attach', session_name: sessions[state.selected].name }
    }
    return { type: 'create', dir: cwd }
  }

  return { type: 'none' }
}

/**
 * 解析 raw stdin 資料為按鍵名稱。
 */
export function parseKey(data: Buffer): string {
  // Ctrl+C
  if (data[0] === 3) return 'CTRL_C'
  // Enter
  if (data[0] === 13) return 'ENTER'
  // Escape sequences
  if (data[0] === 27 && data[1] === 91) {
    if (data[2] === 65) return 'UP'
    if (data[2] === 66) return 'DOWN'
  }
  // Regular character
  return data.toString('utf-8')
}

/**
 * 清除並重繪選單。
 */
function draw(content: string, prev_lines: number): number {
  // 移到最上面清除之前的輸出
  if (prev_lines > 0) {
    process.stdout.write(`\x1b[${prev_lines}A\x1b[J`)
  }
  process.stdout.write(content)
  return content.split('\n').length
}

/**
 * 列出所有 session 並同步每個 session 的 Claude session ID。
 */
function listAndSync(): SessionInfo[] {
  const sessions = listSessions()
  for (const session of sessions) {
    syncSessionId(session.name)
  }
  return sessions
}

/**
 * CLI 進入點。
 */
async function main(): Promise<void> {
  const cwd = process.cwd()
  let sessions = listAndSync()

  // 沒有任何 session 時，直接建立新 session
  if (sessions.length === 0) {
    const session_name = generateSessionName(cwd, sessions)
    console.log(`Creating new session: ${session_name}`)
    createSession(session_name, cwd)
    attachSession(session_name)
    return
  }

  // 顯示互動選單
  let total = sessions.length + 1
  let selected = 0
  let prev_lines = 0

  // 初次渲染
  const initial_content = renderMenu(sessions, cwd, selected)
  prev_lines = draw(initial_content, 0)

  // 設定 raw mode
  if (!process.stdin.isTTY) {
    console.error('Error: stdin is not a TTY')
    process.exit(1)
  }

  process.stdin.setRawMode(true)
  process.stdin.resume()

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeAllListeners('data')
    }

    process.stdin.on('data', (data: Buffer) => {
      const key = parseKey(data)
      const action = handleInput(key, { selected, total }, sessions, cwd)

      switch (action.type) {
        case 'quit':
          cleanup()
          // 清除選單
          draw('', prev_lines)
          resolve()
          break
        case 'move':
          selected = action.selected
          prev_lines = draw(renderMenu(sessions, cwd, selected), prev_lines)
          break
        case 'attach':
          cleanup()
          draw('', prev_lines)
          attachSession(action.session_name)
          resolve()
          break
        case 'create': {
          cleanup()
          draw('', prev_lines)
          const new_name = generateSessionName(cwd, sessions)
          console.log(`Creating new session: ${new_name}`)
          createSession(new_name, cwd)
          attachSession(new_name)
          resolve()
          break
        }
        case 'terminate': {
          killSession(action.session_name)
          sessions = listAndSync()
          const new_total = sessions.length + 1
          total = new_total
          if (selected >= new_total) selected = new_total - 1
          prev_lines = draw(renderMenu(sessions, cwd, selected), prev_lines)
          break
        }
        case 'restart': {
          syncSessionId(action.session_name)
          const claude_session_id = getClaudeSessionId(action.session_name)
          killSession(action.session_name)
          if (claude_session_id && sessionFileExists(action.dir, claude_session_id)) {
            createSessionWithResume(action.session_name, action.dir, claude_session_id)
          } else {
            createSession(action.session_name, action.dir)
          }
          sessions = listAndSync()
          total = sessions.length + 1
          prev_lines = draw(renderMenu(sessions, cwd, selected), prev_lines)
          break
        }
        case 'none':
          // 忽略未知按鍵
          break
      }
    })
  })
}

// 只在直接執行時啟動，import 時不觸發
const is_direct_run = process.argv[1]?.endsWith('main.ts')
if (is_direct_run) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
