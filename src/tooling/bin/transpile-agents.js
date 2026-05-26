#!/usr/bin/env node

import { join } from 'node:path'
import { transpileAgents } from '../agent-transpiler/agent-transpiler.js'

const package_root = process.cwd()
const source_dir = join(package_root, 'agents')
const output_dir = join(package_root, 'dist')

transpileAgents({ source_dir, output_dir }).catch((err) => {
  console.error(`[transpile-agents] ${err.message}`)
  process.exit(1)
})
