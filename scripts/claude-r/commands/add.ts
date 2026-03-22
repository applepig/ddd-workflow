import { parseArgs } from 'node:util'
import { existsSync } from 'node:fs'
import * as path from 'node:path'
import { loadState, saveState } from '../state.ts'
import { createSession } from '../tmux.ts'
import type { RestartPolicy } from '../types.ts'

const VALID_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

export async function add(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string', short: 'd' },
      name: { type: 'string', short: 'n' },
      restart: { type: 'string', short: 'r' },
    },
    strict: true,
  })

  const dir = path.resolve(values.dir ?? process.cwd())

  if (!existsSync(dir)) {
    throw new Error(`Directory does not exist: ${dir}`)
  }

  const safe_basename = path.basename(dir).replace(/[^a-zA-Z0-9_-]/g, '_')
  const default_name = `${safe_basename}-${Date.now().toString(36)}`
  const session_name = values.name ?? default_name

  if (!VALID_NAME_PATTERN.test(session_name)) {
    throw new Error(`Invalid session name: "${session_name}". Only [a-zA-Z0-9_-] are allowed.`)
  }

  const restart_value = values.restart ?? 'always'
  const valid_policies = ['always', 'on-failure', 'no']
  if (!valid_policies.includes(restart_value)) {
    throw new Error(`Invalid restart policy: "${restart_value}". Must be one of: ${valid_policies.join(', ')}`)
  }
  const restart_policy = restart_value as RestartPolicy

  const state = loadState()

  if (state[session_name]) {
    throw new Error(`Session "${session_name}" already exists. Use --name to specify a different name.`)
  }

  state[session_name] = {
    dir,
    restart: restart_policy,
    created_at: new Date().toISOString(),
  }

  saveState(state)
  createSession(session_name, dir, session_name)

  console.log(`Added session "${session_name}" (dir: ${dir}, restart: ${restart_policy})`)
}
