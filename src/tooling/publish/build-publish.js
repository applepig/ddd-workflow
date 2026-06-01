#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'
import { transpileAgents } from '../agent-transpiler/agent-transpiler.js'
import { generateBuildManifest } from '../manifest/build-manifest.js'
import { PUBLISH_ROOT, SOURCE_ROOT, TOOLING_DIST_ROOT } from '../shared/paths.js'
import { assertPublishCheckout } from './status.js'

const PUBLISH_SKIP_ENTRIES = new Set(['_runtime'])
const PUBLIC_BIN_ENTRIES = ['transpile-agents', 'deploy-agents']
const NODE_EXTERNALS = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const TOOLING_ROOT = existsSync(join(resolve(MODULE_DIR, '..'), 'bin', 'transpile-agents.js'))
  ? resolve(MODULE_DIR, '..')
  : resolve(MODULE_DIR, '../../../src/tooling')
const force = process.argv.includes('--force')

function fail(message) {
  console.error(`[build-publish] ${message}`)
  process.exit(1)
}

export function getPublishStatus({ publish_root = PUBLISH_ROOT } = {}) {
  if (!existsSync(join(publish_root, '.git'))) {
    return ''
  }

  const result = spawnSync('git', ['-C', publish_root, 'status', '--short'], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || '無法讀取 publish repo 狀態')
  }

  return result.stdout.trim()
}

export function guardCleanPublish({ publish_root = PUBLISH_ROOT, allow_dirty = false } = {}) {
  if (allow_dirty || !existsSync(join(publish_root, '.git'))) {
    return
  }

  const status = getPublishStatus({ publish_root })
  if (status) {
    throw new Error(`.publish/ddd-workflow 有未提交變更，請先處理或使用 --force：\n${status}`)
  }
}

export function clearPublishRoot({ publish_root = PUBLISH_ROOT } = {}) {
  mkdirSync(publish_root, { recursive: true })

  for (const entry of readdirSync(publish_root, { withFileTypes: true })) {
    if (entry.name === '.git') {
      continue
    }

    rmSync(join(publish_root, entry.name), { recursive: true, force: true })
  }
}

export function syncPublishTree({
  source_root = SOURCE_ROOT,
  publish_root = PUBLISH_ROOT,
} = {}) {
  if (!existsSync(source_root)) {
    throw new Error(`找不到 source root：${source_root}`)
  }

  clearPublishRoot({ publish_root })

  for (const entry of readdirSync(source_root, { withFileTypes: true })) {
    if (PUBLISH_SKIP_ENTRIES.has(entry.name)) {
      continue
    }

    cpSync(join(source_root, entry.name), join(publish_root, entry.name), {
      recursive: true,
      dereference: true,
      preserveTimestamps: true,
    })
  }
}

export function writePublishGitignore({ publish_root = PUBLISH_ROOT } = {}) {
  const gitignore_path = join(publish_root, '.gitignore')
  const existing = existsSync(gitignore_path) ? readFileSync(gitignore_path, 'utf8') : ''
  const lines = existing.split('\n').filter(Boolean)

  for (const entry of ['dist/', 'node_modules/']) {
    if (!lines.includes(entry)) {
      lines.push(entry)
    }
  }

  writeFileSync(gitignore_path, `${lines.join('\n')}\n`)
}

export function materializeSymlinks(target_dir) {
  for (const entry of readdirSync(target_dir, { withFileTypes: true })) {
    if (entry.name === '.git') {
      continue
    }

    const full_path = join(target_dir, entry.name)
    const lst = lstatSync(full_path)

    if (lst.isSymbolicLink()) {
      const link_target = readlinkSync(full_path)
      const resolved_target = resolve(dirname(full_path), link_target)
      const content = readFileSync(resolved_target)
      const target_mode = statSync(resolved_target).mode
      rmSync(full_path)
      writeFileSync(full_path, content, { mode: target_mode })
      continue
    }

    if (lst.isDirectory()) {
      materializeSymlinks(full_path)
    }
  }
}

export function writePublishPackageJson({ publish_root = PUBLISH_ROOT } = {}) {
  const package_json = {
    name: 'ddd-workflow',
    version: '0.1.0',
    type: 'module',
    private: true,
    scripts: {
      'agents:build': 'node bin/transpile-agents.mjs',
      'agents:deploy': 'node bin/deploy-agents.mjs',
    },
  }

  writeFileSync(join(publish_root, 'package.json'), `${JSON.stringify(package_json, null, 2)}\n`)
}

export async function buildPublicBins({
  publish_root = PUBLISH_ROOT,
} = {}) {
  const target_bin_dir = join(publish_root, 'bin')
  mkdirSync(target_bin_dir, { recursive: true })

  for (const entry_name of PUBLIC_BIN_ENTRIES) {
    await viteBuild({
      configFile: false,
      logLevel: 'silent',
      build: {
        outDir: target_bin_dir,
        emptyOutDir: false,
        target: 'node20',
        rollupOptions: {
          external: NODE_EXTERNALS,
          input: join(TOOLING_ROOT, 'bin', `${entry_name}.js`),
          output: {
            format: 'es',
            banner: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
            entryFileNames: `${entry_name}.mjs`,
            codeSplitting: false,
          },
        },
      },
    })
  }
}

export function assertNoSymlinks(target_dir) {
  for (const entry of readdirSync(target_dir, { withFileTypes: true })) {
    if (entry.name === '.git') {
      continue
    }

    const full_path = join(target_dir, entry.name)
    const stat = statSync(full_path)

    if (entry.isSymbolicLink()) {
      throw new Error(`publish repo 不可包含 symlink：${full_path}`)
    }

    if (stat.isDirectory()) {
      assertNoSymlinks(full_path)
    }
  }
}

export async function buildPublish({
  source_root = SOURCE_ROOT,
  publish_root = PUBLISH_ROOT,
  allow_dirty = force,
  tooling_dist_root = TOOLING_DIST_ROOT,
  logger = console,
} = {}) {
  assertPublishCheckout({ publish_root })
  guardCleanPublish({ publish_root, allow_dirty })
  syncPublishTree({ source_root, publish_root })
  materializeSymlinks(publish_root)
  writePublishGitignore({ publish_root })
  writePublishPackageJson({ publish_root })
  await buildPublicBins({ tooling_dist_root, publish_root })
  await transpileAgents({
    source_dir: join(publish_root, 'agents'),
    output_dir: join(publish_root, 'dist'),
    logger,
  })
  assertNoSymlinks(publish_root)

  const manifest = await generateBuildManifest({ source_root, publish_root })
  writeFileSync(join(publish_root, '.build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  logger.log?.(`[build-publish] 已同步 ${source_root} -> ${publish_root}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildPublish().catch((err) => fail(err.message))
}
