import { loadState } from '../state.ts'
import { killSession, createSession } from '../tmux.ts'
import { resolveName } from '../resolve-name.ts'

export async function restart(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new Error('Usage: claude-r restart <name>')
  }

  const input = args[0]
  const state = loadState()
  const resolved_name = resolveName(input, state)
  const config = state[resolved_name]

  killSession(resolved_name)
  createSession(resolved_name, config.dir, resolved_name)
  console.log(`Restarted session "${resolved_name}".`)
}
