#!/usr/bin/env tsx

import { add } from './commands/add.ts'
import { rm } from './commands/rm.ts'
import { ls } from './commands/ls.ts'
import { resume } from './commands/resume.ts'
import { restart } from './commands/restart.ts'
import { rename } from './commands/rename.ts'
import { help } from './commands/help.ts'

const args = process.argv.slice(2)
const command = args[0]

async function main() {
  switch (command) {
    case 'add':
      await add(args.slice(1))
      break
    case 'rm': case 'remove':
      await rm(args.slice(1))
      break
    case 'ls': case 'list':
      await ls(args.slice(1))
      break
    case 'resume':
      await resume(args.slice(1))
      break
    case 'restart':
      await restart(args.slice(1))
      break
    case 'rename':
      await rename(args.slice(1))
      break
    case 'daemon': {
      const { runDaemon } = await import('./commands/daemon.ts')
      await runDaemon()
      break
    }
    case 'install': {
      const { install } = await import('./commands/install.ts')
      await install(args.slice(1))
      break
    }
    case 'uninstall': {
      const { uninstall } = await import('./commands/uninstall.ts')
      await uninstall(args.slice(1))
      break
    }
    case 'help': case '--help': case '-h':
      help()
      break
    default:
      if (!command && process.stdin.isTTY) {
        const { interactive } = await import('./commands/interactive.ts')
        await interactive()
      } else if (!command) {
        await ls([])
      } else {
        console.error(`Unknown command: ${command}`)
        help()
        process.exit(1)
      }
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
