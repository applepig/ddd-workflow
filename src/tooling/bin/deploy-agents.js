#!/usr/bin/env node

import { ALL_TARGETS, applyDeployActions, planDeploy } from '../deploy/deploy-local.js'

const dry_run = process.argv.includes('--dry-run')
const targets = process.argv.slice(2).filter((arg) => ALL_TARGETS.includes(arg))
const package_root = process.cwd()

try {
  const actions = planDeploy({
    publish_root: package_root,
    targets: targets.length > 0 ? targets : ALL_TARGETS,
  }).filter((action) => action.type !== 'command')

  applyDeployActions(actions, { dry_run })
} catch (err) {
  console.error(`[deploy-agents] ${err.message}`)
  process.exit(1)
}
