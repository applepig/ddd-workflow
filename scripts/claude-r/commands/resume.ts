import { loadState } from '../state.ts'
import { sessionExists, attachSession } from '../tmux.ts'
import { resolveName } from '../resolve-name.ts'

export async function resume(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new Error('Usage: claude-r resume <name>')
  }

  const input = args[0]
  const state = loadState()
  const resolved_name = resolveName(input, state)

  if (!sessionExists(resolved_name)) {
    throw new Error(`Session "${resolved_name}" is not running. Use 'claude-r restart ${resolved_name}' to restart it.`)
  }

  attachSession(resolved_name)
}
