#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PUBLISH_ROOT } from '../shared/paths.js'

export const ALL_TARGETS = ['claude', 'gemini', 'codex', 'opencode']

function listFiles(dir, predicate = () => true) {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir)
    .filter(predicate)
    .map((name) => join(dir, name))
}

function copyActionsFromDir(source_dir, target_dir, predicate = () => true) {
  return listFiles(source_dir, predicate).map((source) => ({
    type: 'copy',
    source,
    target: join(target_dir, source.split('/').pop()),
    mode: 'overwrite-generated',
  }))
}

export function planSkillsInstall({ publish_root = PUBLISH_ROOT } = {}) {
  return {
    type: 'command',
    command: 'npx',
    args: [
      'skills',
      'add',
      publish_root,
      '--skill',
      '*',
      '-g',
      '-a',
      'claude-code',
      '-a',
      'opencode',
      '-a',
      'codex',
      '-a',
      'gemini-cli',
    ],
    label: 'install skills with npx skills',
  }
}

export function planConfigDeploy({ publish_root = PUBLISH_ROOT, home_dir = homedir() } = {}) {
  return [
    {
      type: 'copy',
      source: join(publish_root, 'config', 'xreview.json'),
      target: join(home_dir, '.config', 'ddd-workflow', 'xreview.json'),
      mode: 'copy-if-missing-config',
    },
  ]
}

export function planClaudeDeploy({ publish_root = PUBLISH_ROOT, home_dir = homedir() } = {}) {
  return [
    {
      type: 'copy',
      source: join(publish_root, 'references', 'AGENTS.md'),
      target: join(home_dir, '.claude', 'CLAUDE.md'),
      mode: 'overwrite-generated',
    },
    ...copyActionsFromDir(
      join(publish_root, 'agents'),
      join(home_dir, '.claude', 'agents'),
      (name) => name.endsWith('.md'),
    ),
    {
      type: 'copy',
      source: join(publish_root, 'scripts', 'claude', 'statusline.sh'),
      target: join(home_dir, '.claude', 'scripts', 'statusline.sh'),
      mode: 'overwrite-generated',
    },
  ]
}

export function planGeminiDeploy({ publish_root = PUBLISH_ROOT, home_dir = homedir() } = {}) {
  return [
    {
      type: 'copy',
      source: join(publish_root, 'references', 'AGENTS.md'),
      target: join(home_dir, '.gemini', 'GEMINI.md'),
      mode: 'overwrite-generated',
    },
    ...copyActionsFromDir(
      join(publish_root, 'dist', 'gemini', 'agents'),
      join(home_dir, '.gemini', 'agents'),
      (name) => name.endsWith('.md'),
    ),
    ...copyActionsFromDir(
      join(publish_root, 'policies'),
      join(home_dir, '.gemini', 'policies'),
      (name) => name.endsWith('.toml'),
    ),
  ]
}

export function planCodexDeploy({ publish_root = PUBLISH_ROOT, home_dir = homedir() } = {}) {
  return [
    {
      type: 'copy',
      source: join(publish_root, 'references', 'AGENTS.md'),
      target: join(home_dir, '.codex', 'AGENTS.md'),
      mode: 'overwrite-generated',
    },
    ...copyActionsFromDir(
      join(publish_root, 'dist', 'codex', 'agents'),
      join(home_dir, '.codex', 'agents'),
      (name) => name.endsWith('.toml'),
    ),
  ]
}

export function planOpencodeDeploy({ publish_root = PUBLISH_ROOT, home_dir = homedir() } = {}) {
  return [
    {
      type: 'copy',
      source: join(publish_root, 'config', 'opencode-tui.json'),
      target: join(home_dir, '.config', 'opencode', 'tui.json'),
      mode: 'overwrite-generated',
    },
    {
      type: 'copy',
      source: join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-capture.js'),
      target: join(home_dir, '.config', 'opencode', 'plugins', 'opencode-codex-usage-capture.js'),
      mode: 'overwrite-generated',
    },
    {
      type: 'copy',
      source: join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-status.tsx'),
      target: join(home_dir, '.config', 'opencode', 'tui-plugins', 'opencode-codex-usage-status.tsx'),
      mode: 'overwrite-generated',
    },
    {
      type: 'copy',
      source: join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-format.js'),
      target: join(home_dir, '.config', 'opencode', 'tui-plugins', 'opencode-codex-usage-format.js'),
      mode: 'overwrite-generated',
    },
    ...copyActionsFromDir(
      join(publish_root, 'dist', 'opencode', 'agents'),
      join(home_dir, '.config', 'opencode', 'agents'),
      (name) => name.endsWith('.md'),
    ),
  ]
}

export function planRuntimeDeploy({ publish_root = PUBLISH_ROOT, home_dir = homedir() } = {}) {
  return [
    {
      type: 'copy',
      source: join(publish_root, 'scripts', 'shared', 'session-trigger.mjs'),
      target: join(home_dir, '.config', 'ddd-workflow', 'runtime', 'shared', 'session-trigger.mjs'),
      mode: 'overwrite-generated',
    },
  ]
}

export function planDeploy({
  publish_root = PUBLISH_ROOT,
  home_dir = homedir(),
  targets = ALL_TARGETS,
} = {}) {
  const actions = [
    planSkillsInstall({ publish_root }),
    ...planConfigDeploy({ publish_root, home_dir }),
    ...planRuntimeDeploy({ publish_root, home_dir }),
  ]

  for (const target of targets) {
    if (target === 'claude') actions.push(...planClaudeDeploy({ publish_root, home_dir }))
    if (target === 'gemini') actions.push(...planGeminiDeploy({ publish_root, home_dir }))
    if (target === 'codex') actions.push(...planCodexDeploy({ publish_root, home_dir }))
    if (target === 'opencode') actions.push(...planOpencodeDeploy({ publish_root, home_dir }))
  }

  return actions
}

export function applyDeployActions(actions, { dry_run = false, logger = console } = {}) {
  for (const action of actions) {
    if (action.type === 'command') {
      logger.log(`[deploy-local] command: ${action.command} ${action.args.join(' ')}`)
      if (!dry_run) {
        const result = spawnSync(action.command, action.args, { stdio: 'inherit' })
        if (result.status !== 0) {
          throw new Error(`${action.label} failed`)
        }
      }
      continue
    }

    if (action.mode === 'copy-if-missing-config' && existsSync(action.target)) {
      logger.log(`[deploy-local] skip existing config: ${action.target}`)
      continue
    }

    logger.log(`[deploy-local] copy: ${action.source} -> ${action.target}`)
    if (!dry_run) {
      mkdirSync(dirname(action.target), { recursive: true })
      copyFileSync(action.source, action.target)
    }
  }
}

function parseArgs(argv) {
  const dry_run = argv.includes('--dry-run')
  const targets = argv.filter((arg) => ALL_TARGETS.includes(arg))
  return { dry_run, targets: targets.length > 0 ? targets : ALL_TARGETS }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dry_run, targets } = parseArgs(process.argv.slice(2))
  const actions = planDeploy({ targets })
  try {
    applyDeployActions(actions, { dry_run })
  } catch (err) {
    console.error(`[deploy-local] ${err.message}`)
    process.exit(1)
  }
}
