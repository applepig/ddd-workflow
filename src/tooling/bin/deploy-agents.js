#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { ALL_TARGETS, applyDeployActions, planDeploy } from '../deploy/deploy-local.js'

const dry_run = process.argv.includes('--dry-run')
const targets = process.argv.slice(2).filter((arg) => ALL_TARGETS.includes(arg))
const package_root = process.cwd()

async function buildInteractiveSettings(actions) {
  const decisions = new Map()

  for (const action of actions) {
    if (action.type !== 'claude-settings' || !hasConflictingStatusLine(action)) {
      continue
    }

    decisions.set(action.target, await confirmOverwrite(action.target))
  }

  return {
    confirm: ({ target }) => decisions.get(target) === true,
  }
}

function hasConflictingStatusLine(action) {
  if (!existsSync(action.target)) {
    return false
  }

  const settings = JSON.parse(readFileSync(action.target, 'utf8'))
  if (!settings.statusLine) {
    return false
  }

  return JSON.stringify(settings.statusLine) !== JSON.stringify(action.statusLine)
}

async function confirmOverwrite(target) {
  if (!process.stdin.isTTY) {
    return false
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await prompt.question(`[deploy-agents] overwrite existing Claude statusLine in ${target}? [y/N] `)
    return answer.trim().toLowerCase() === 'y'
  } finally {
    prompt.close()
  }
}

try {
  const actions = planDeploy({
    publish_root: package_root,
    targets: targets.length > 0 ? targets : ALL_TARGETS,
  }).filter((action) => action.type !== 'command')

  applyDeployActions(actions, {
    dry_run,
    interactive_settings: await buildInteractiveSettings(actions),
  })
} catch (err) {
  console.error(`[deploy-agents] ${err.message}`)
  process.exit(1)
}
