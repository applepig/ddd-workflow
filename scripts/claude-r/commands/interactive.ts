import * as os from 'node:os'
import * as p from '@clack/prompts'
import { loadState } from '../state.ts'
import { listSessions } from '../tmux.ts'
import { add } from './add.ts'
import { rm } from './rm.ts'
import { resume } from './resume.ts'
import { restart } from './restart.ts'
import type { State } from '../types.ts'

function shortenDir(dir: string): string {
  const home = os.homedir()
  if (dir.startsWith(home)) {
    return '~' + dir.slice(home.length)
  }
  return dir
}

/**
 * 互動式主選單。
 * TTY 環境下顯示 session 列表 + 操作選單。
 */
export async function interactive(): Promise<void> {
  const state = loadState()
  const running = listSessions()
  const names = Object.keys(state)

  if (names.length === 0) {
    const confirmed = await p.confirm({
      message: `Add a new session in ${shortenDir(process.cwd())}?`,
    })

    if (p.isCancel(confirmed)) {
      process.exit(0)
    }

    if (confirmed) {
      await add([])
    }
    return
  }

  await showMainMenu(state, running, names)
}

async function showMainMenu(
  state: State,
  running: string[],
  names: string[],
): Promise<void> {
  const session_options = names.map((name) => {
    const config = state[name]
    const status = running.includes(name) ? 'running' : 'dead'
    const dir = shortenDir(config.dir)
    return {
      value: name,
      label: `${name}    ${dir}    ${status}`,
    }
  })

  const selected = await p.select({
    message: 'Claude Remote Sessions',
    options: [
      ...session_options,
      { value: '__separator__', label: '─────────────────────', hint: '' },
      { value: '__add__', label: '+ Add new session' },
      { value: '__remove_all__', label: '✕ Remove all sessions' },
      { value: '__back__', label: '← Quit' },
    ],
  })

  if (p.isCancel(selected)) {
    process.exit(0)
  }

  if (selected === '__back__' || selected === '__separator__') {
    return
  }

  if (selected === '__add__') {
    await add([])
    return
  }

  if (selected === '__remove_all__') {
    await rm(['--all', '--force'])
    return
  }

  // A session was selected — show action submenu
  await showActionMenu(selected as string, state, running, names)
}

async function showActionMenu(
  session_name: string,
  state: State,
  running: string[],
  names: string[],
): Promise<void> {
  const config = state[session_name]
  const is_running = running.includes(session_name)
  const status = is_running ? 'running' : 'dead'
  const dir = shortenDir(config.dir)

  const resume_option = is_running
    ? { value: 'resume', label: 'Resume' }
    : { value: 'resume', label: 'Resume', hint: 'not running' }

  const action = await p.select({
    message: `${session_name}    ${dir}    ${status}`,
    options: [
      resume_option,
      { value: 'restart', label: 'Restart' },
      { value: 'remove', label: 'Remove' },
      { value: 'back', label: '← Back' },
    ],
  })

  if (p.isCancel(action)) {
    process.exit(0)
  }

  switch (action) {
    case 'resume':
      await resume([session_name])
      break
    case 'restart':
      await restart([session_name])
      break
    case 'remove':
      await rm([session_name])
      break
    case 'back':
      await showMainMenu(state, running, names)
      break
  }
}
