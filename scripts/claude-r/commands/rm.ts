import { parseArgs } from 'node:util'
import * as readline from 'node:readline'
import { loadState, saveState } from '../state.ts'
import { killSession } from '../tmux.ts'
import { resolveName } from '../resolve-name.ts'

export async function rm(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      all: { type: 'boolean', short: 'a', default: false },
      force: { type: 'boolean', short: 'f', default: false },
    },
    allowPositionals: true,
  })

  const state = loadState()

  if (values.all) {
    const names = Object.keys(state)

    if (!values.force) {
      const confirmed = await askConfirmation(`Remove ${names.length} session(s)? [y/N] `)
      if (!confirmed) {
        return
      }
    }

    for (const name of names) {
      killSession(name)
    }
    saveState({})
    console.log(`Removed ${names.length} session(s).`)
    return
  }

  if (positionals.length === 0) {
    throw new Error('Usage: claude-r rm <name> or claude-r rm --all')
  }

  const input = positionals[0]
  const resolved_name = resolveName(input, state)

  delete state[resolved_name]
  saveState(state)
  killSession(resolved_name)
  console.log(`Removed session "${resolved_name}".`)
}

function askConfirmation(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}
