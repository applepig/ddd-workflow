#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PUBLISH_ROOT, SOURCE_ROOT } from '../shared/paths.js'
import {
  readBuildManifest,
  readDeployManifest,
  diffManifests,
  writeDeployManifest,
  buildDeployManifest,
  checkStaleBuild,
} from '../manifest/deploy-manifest.js'

export const ALL_TARGETS = ['claude', 'gemini', 'codex', 'opencode']

function listFiles(dir, predicate = () => true) {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir)
    .filter(predicate)
    .map((name) => join(dir, name))
}

function copyActionsFromDir(source_dir, target_dir, predicate = () => true, get_unit = () => null) {
  return listFiles(source_dir, predicate).map((source) => ({
    type: 'copy',
    unit: get_unit(source.split('/').pop()),
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
      '-y',
      'skills',
      'add',
      publish_root,
      '--skill',
      '*',
      '-g',
      '-y',
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
      unit: 'config:xreview',
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
      unit: 'reference:AGENTS.md',
      source: join(publish_root, 'references', 'AGENTS.md'),
      target: join(home_dir, '.claude', 'CLAUDE.md'),
      mode: 'overwrite-generated',
    },
    ...copyActionsFromDir(
      join(publish_root, 'agents'),
      join(home_dir, '.claude', 'agents'),
      (name) => name.endsWith('.md'),
      (name) => `agent:claude:${name.replace(/\.md$/, '')}`,
    ),
    {
      type: 'copy',
      unit: 'script:claude:statusline.sh',
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
      unit: 'reference:AGENTS.md',
      source: join(publish_root, 'references', 'AGENTS.md'),
      target: join(home_dir, '.gemini', 'GEMINI.md'),
      mode: 'overwrite-generated',
    },
    ...copyActionsFromDir(
      join(publish_root, 'dist', 'gemini', 'agents'),
      join(home_dir, '.gemini', 'agents'),
      (name) => name.endsWith('.md'),
      (name) => `agent:gemini:${name.replace(/\.md$/, '')}`,
    ),
    ...copyActionsFromDir(
      join(publish_root, 'policies'),
      join(home_dir, '.gemini', 'policies'),
      (name) => name.endsWith('.toml'),
      (name) => `policy:${name}`,
    ),
  ]
}

export function planCodexDeploy({ publish_root = PUBLISH_ROOT, home_dir = homedir() } = {}) {
  return [
    {
      type: 'copy',
      unit: 'reference:AGENTS.md',
      source: join(publish_root, 'references', 'AGENTS.md'),
      target: join(home_dir, '.codex', 'AGENTS.md'),
      mode: 'overwrite-generated',
    },
    ...copyActionsFromDir(
      join(publish_root, 'dist', 'codex', 'agents'),
      join(home_dir, '.codex', 'agents'),
      (name) => name.endsWith('.toml'),
      (name) => `agent:codex:${name.replace(/\.toml$/, '')}`,
    ),
  ]
}

export function planOpencodeDeploy({ publish_root = PUBLISH_ROOT, home_dir = homedir() } = {}) {
  return [
    {
      type: 'copy',
      unit: 'config:opencode-tui',
      source: join(publish_root, 'config', 'opencode-tui.json'),
      target: join(home_dir, '.config', 'opencode', 'tui.json'),
      mode: 'overwrite-generated',
    },
    {
      type: 'copy',
      unit: 'script:opencode:opencode-codex-usage-capture.js',
      source: join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-capture.js'),
      target: join(home_dir, '.config', 'opencode', 'plugins', 'opencode-codex-usage-capture.js'),
      mode: 'overwrite-generated',
    },
    {
      type: 'copy',
      unit: 'script:opencode:opencode-codex-usage-status.tsx',
      source: join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-status.tsx'),
      target: join(home_dir, '.config', 'opencode', 'tui-plugins', 'opencode-codex-usage-status.tsx'),
      mode: 'overwrite-generated',
    },
    {
      type: 'copy',
      unit: 'script:opencode:opencode-codex-usage-format.js',
      source: join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-format.js'),
      target: join(home_dir, '.config', 'opencode', 'tui-plugins', 'opencode-codex-usage-format.js'),
      mode: 'overwrite-generated',
    },
    ...copyActionsFromDir(
      join(publish_root, 'dist', 'opencode', 'agents'),
      join(home_dir, '.config', 'opencode', 'agents'),
      (name) => name.endsWith('.md'),
      (name) => `agent:opencode:${name.replace(/\.md$/, '')}`,
    ),
  ]
}

export function planRuntimeDeploy({ publish_root = PUBLISH_ROOT, home_dir = homedir() } = {}) {
  return [
    {
      type: 'copy',
      unit: 'script:shared:session-trigger.mjs',
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
  include_skills = true,
} = {}) {
  const actions = [
    ...planConfigDeploy({ publish_root, home_dir }),
    ...planRuntimeDeploy({ publish_root, home_dir }),
  ]

  if (include_skills) {
    actions.unshift(planSkillsInstall({ publish_root }))
  }

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

export function parseArgs(argv) {
  const dry_run = argv.includes('--dry-run')
  const include_skills = !argv.includes('--skip-skills')
  const targets = argv.filter((arg) => ALL_TARGETS.includes(arg))
  const home_dir_index = argv.indexOf('--home-dir')
  const home_dir = home_dir_index === -1 ? homedir() : argv[home_dir_index + 1]

  if (home_dir_index !== -1 && !home_dir) {
    throw new Error('--home-dir requires a path')
  }

  return {
    dry_run,
    home_dir,
    include_skills,
    targets: targets.length > 0 ? targets : ALL_TARGETS,
  }
}

/**
 * Deploy manifest 儲存位置。
 */
export function resolveDeployManifestPath(home_dir) {
  return join(home_dir, '.config', 'ddd-workflow', 'deploy.json')
}

/**
 * copy-if-missing unit key 與 home_dir 底下 target 路徑的對應。
 */
const CONFIG_TARGET_MAP = {
  'config:xreview': (home_dir) => join(home_dir, '.config', 'ddd-workflow', 'xreview.json'),
}

/**
 * 根據 unit key 判斷 deploy target 是否已存在。
 * 僅用於 copy-if-missing strategy 的 units。
 */
export function checkTargetExistsForUnit(unit_key, home_dir) {
  const resolver = CONFIG_TARGET_MAP[unit_key]
  if (!resolver) {
    return false
  }

  return existsSync(resolver(home_dir))
}

/**
 * 從 planDeploy 的 action list 中，根據 unit key 找出對應的 deploy target path。
 * skill units 統一回傳 "npx-skills"（由 npx skills 管理，無對應單一路徑）。
 */
export function resolveUnitTarget(unit_key, actions) {
  const targets = resolveUnitTargets(unit_key, actions)
  return targets[0] || null
}

function resolveUnitTargets(unit_key, actions) {
  if (unit_key.startsWith('skill:')) {
    return ['npx-skills']
  }

  const targets = []
  for (const action of actions) {
    if (action.type !== 'copy') {
      continue
    }

    if (action.unit === unit_key) {
      targets.push(action.target)
    }
  }

  if (targets.length > 0) {
    return targets
  }

  const home_dir = inferHomeDirFromActions(actions)
  if (home_dir) {
    const target = resolveKnownUnitTarget(unit_key, home_dir)
    return target ? [target] : []
  }

  return []
}

function inferHomeDirFromActions(actions) {
  for (const action of actions) {
    if (action.type !== 'copy') continue

    const markers = ['/.config/', '/.claude/', '/.gemini/', '/.codex/']
    for (const marker of markers) {
      const marker_index = action.target.indexOf(marker)
      if (marker_index !== -1) {
        return action.target.slice(0, marker_index)
      }
    }
  }

  return null
}

function resolveKnownUnitTarget(unit_key, home_dir) {
  const parts = unit_key.split(':')

  if (parts[0] === 'agent') {
    const platform = parts[1]
    const name = parts[2]
    if (platform === 'claude') return join(home_dir, '.claude', 'agents', `${name}.md`)
    if (platform === 'gemini') return join(home_dir, '.gemini', 'agents', `${name}.md`)
    if (platform === 'opencode') return join(home_dir, '.config', 'opencode', 'agents', `${name}.md`)
    if (platform === 'codex') return join(home_dir, '.codex', 'agents', `${name}.toml`)
  }

  if (unit_key === 'reference:AGENTS.md') return join(home_dir, '.claude', 'CLAUDE.md')
  if (unit_key === 'config:xreview') return join(home_dir, '.config', 'ddd-workflow', 'xreview.json')
  if (unit_key === 'config:opencode-tui') return join(home_dir, '.config', 'opencode', 'tui.json')
  if (unit_key === 'script:claude:statusline.sh') return join(home_dir, '.claude', 'scripts', 'statusline.sh')
  if (unit_key === 'script:shared:session-trigger.mjs') return join(home_dir, '.config', 'ddd-workflow', 'runtime', 'shared', 'session-trigger.mjs')
  if (unit_key.startsWith('script:opencode:')) {
    const name = parts[2]
    if (name === 'opencode-codex-usage-capture.js') return join(home_dir, '.config', 'opencode', 'plugins', name)
    return join(home_dir, '.config', 'opencode', 'tui-plugins', name)
  }
  if (unit_key.startsWith('policy:')) return join(home_dir, '.gemini', 'policies', parts[1])

  return null
}

function applyRemoveActions(remove_entries, deploy_manifest, { dry_run, logger }) {
  for (const entry of remove_entries) {
    const targets = getManagedTargets(deploy_manifest?.units?.[entry.unit])
    if (targets.length === 0) {
      logger.log(`[deploy-local] remove manifest entry only: ${entry.unit}`)
      continue
    }

    for (const target of targets) {
      logger.log(`[deploy-local] remove: ${target}`)
      if (!dry_run) {
        rmSync(target, { force: true })
      }
    }
  }
}

function getManagedTargets(unit_entry) {
  const raw_targets = [
    ...(Array.isArray(unit_entry?.targets) ? unit_entry.targets : []),
    unit_entry?.target,
  ]

  return [...new Set(raw_targets.filter((target) => target && target !== 'npx-skills'))]
}

/**
 * Manifest-aware deploy：stale check → diff → deploy → write manifest。
 * 回傳 { has_changes, diff }。
 */
export async function runManifestAwareDeploy({
  publish_root = PUBLISH_ROOT,
  home_dir,
  source_root = SOURCE_ROOT,
  include_skills = true,
  targets = ALL_TARGETS,
  dry_run = false,
  logger = console,
}) {
  const build_manifest = readBuildManifest(publish_root)
  const deploy_manifest_path = resolveDeployManifestPath(home_dir)
  const deploy_manifest = readDeployManifest(deploy_manifest_path)

  // Stale build check
  await checkStaleBuild({ source_root, build_manifest })

  // Diff
  const diff = diffManifests(build_manifest, deploy_manifest, {
    checkTargetExists: (unit_key) => checkTargetExistsForUnit(unit_key, home_dir),
  })

  // Log diff summary
  for (const entry of diff) {
    logger.log(`[deploy] ${entry.action}: ${entry.unit} (${entry.reason})`)
  }

  const has_changes = diff.some((e) => e.action !== 'skip')
  if (!has_changes) {
    logger.log('[deploy] all units up-to-date, skipping deploy')
    return { has_changes: false, diff }
  }

  const actions = planDeploy({ publish_root, home_dir, include_skills, targets })
  const install_units = new Set(diff.filter((entry) => entry.action === 'install').map((entry) => entry.unit))
  const install_actions = actions.filter((action) => {
    if (action.type === 'command') {
      return [...install_units].some((unit_key) => unit_key.startsWith('skill:'))
    }

    return install_units.has(action.unit)
  })
  const remove_entries = diff.filter((entry) => entry.action === 'remove')

  applyDeployActions(install_actions, { dry_run, logger })
  applyRemoveActions(remove_entries, deploy_manifest, { dry_run, logger })

  // Write deploy manifest（dry-run 不寫）
  if (!dry_run) {
    const deployed_units = {}
    for (const entry of diff) {
      if (entry.action === 'install' || entry.action === 'skip') {
        const targets = resolveUnitTargets(entry.unit, actions)
        const target = targets[0]
        if (!target) continue
        const hash = build_manifest.units[entry.unit]?.hash
          || deploy_manifest?.units[entry.unit]?.hash
        deployed_units[entry.unit] = {
          hash,
          target,
          ...(targets.length > 1 ? { targets } : {}),
          ...(entry.action === 'skip' ? { skipped: true } : {}),
        }
      }
    }

    const new_deploy_manifest = buildDeployManifest({
      deploy_from: publish_root,
      units: deployed_units,
    })
    writeDeployManifest(deploy_manifest_path, new_deploy_manifest)
  }

  return { has_changes: true, diff }
}

// process.argv[1] 在 Vite bundle 後仍指向 entrypoint（deploy-local.mjs），
// 但 import.meta.url 指向 chunk，不能用來做 direct-run 判斷。
const is_cli = process.argv[1]
  && (process.argv[1].endsWith('/deploy-local.js') || process.argv[1].endsWith('/deploy-local.mjs'))
if (is_cli) {
  try {
    const { dry_run, home_dir, include_skills, targets } = parseArgs(process.argv.slice(2))
    const result = await runManifestAwareDeploy({
      home_dir,
      include_skills,
      targets,
      dry_run,
    })

    if (!result.has_changes) {
      process.exit(0)
    }
  } catch (err) {
    console.error(`[deploy-local] ${err.message}`)
    process.exit(1)
  }
}
