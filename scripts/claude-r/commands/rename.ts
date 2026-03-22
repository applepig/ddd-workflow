import { loadState, saveState } from '../state.ts'
import { killSession, createSession } from '../tmux.ts'
import { resolveName } from '../resolve-name.ts'

const VALID_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

export async function rename(args: string[]): Promise<void> {
  if (args.length < 2) {
    throw new Error('Usage: claude-r rename <old-name> <new-name>')
  }

  const [old_input, new_name] = args
  const state = loadState()
  const old_name = resolveName(old_input, state)

  if (!VALID_NAME_PATTERN.test(new_name)) {
    throw new Error(`Invalid name "${new_name}". Name must only contain alphanumeric characters, hyphens, and underscores.`)
  }

  if (state[new_name] !== undefined) {
    throw new Error(`Session "${new_name}" already exists.`)
  }

  const config = state[old_name]
  delete state[old_name]
  state[new_name] = config
  saveState(state)

  killSession(old_name)
  createSession(new_name, config.dir, new_name)
  console.log(`Renamed session "${old_name}" to "${new_name}".`)
}
