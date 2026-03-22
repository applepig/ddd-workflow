import { parseArgs } from 'node:util'
import * as os from 'node:os'
import { loadState } from '../state.ts'
import { listSessions } from '../tmux.ts'
import type { RestartPolicy } from '../types.ts'

function getStatus(name: string, running_sessions: string[], restart: RestartPolicy): string {
  if (running_sessions.includes(name)) {
    return 'running'
  }

  if (restart === 'always' || restart === 'on-failure') {
    return 'dead (restarting...)'
  }

  return 'dead'
}

function shortenDir(dir: string): string {
  const home = os.homedir()
  if (dir.startsWith(home)) {
    return '~' + dir.slice(home.length)
  }
  return dir
}

export async function ls(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      quiet: { type: 'boolean', short: 'q' },
    },
    strict: true,
  })

  const state = loadState()
  const names = Object.keys(state)

  if (names.length === 0) {
    console.log('No claude sessions.')
    return
  }

  const running_sessions = listSessions()

  if (values.quiet) {
    console.log(names.join('\n'))
    return
  }

  const rows = names.map((name) => ({
    name,
    dir: shortenDir(state[name].dir),
    restart: state[name].restart,
    status: getStatus(name, running_sessions, state[name].restart),
  }))

  const col_widths = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    dir: Math.max(3, ...rows.map((r) => r.dir.length)),
    restart: Math.max(7, ...rows.map((r) => r.restart.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
  }

  const pad = (str: string, width: number) => str.padEnd(width)

  const header = [
    pad('NAME', col_widths.name),
    pad('DIR', col_widths.dir),
    pad('RESTART', col_widths.restart),
    pad('STATUS', col_widths.status),
  ].join('    ')

  const lines = rows.map((r) =>
    [
      pad(r.name, col_widths.name),
      pad(r.dir, col_widths.dir),
      pad(r.restart, col_widths.restart),
      pad(r.status, col_widths.status),
    ].join('    ')
  )

  console.log([header, ...lines].join('\n'))
}
