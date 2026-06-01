import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from 'node:fs'
import { join, relative } from 'node:path'

function isTestFile(filename) {
  return /\.test\./.test(filename)
}

const SKIP_DIRS = new Set(['.git'])
const SOURCE_SKIP_DIRS = new Set(['.git', '_runtime'])

const EXCLUDED_TOP_LEVEL = new Set([
  '.git',
  '.gitignore',
  'package.json',
  'README.md',
  'LICENSE',
  'bin',
  'dist',
  '.build-manifest.json',
])

const COPY_IF_MISSING_UNITS = new Set([
  'config:xreview',
])

const DIST_AGENT_PLATFORMS = [
  { dir: 'gemini', prefix: 'agent:gemini' },
  { dir: 'opencode', prefix: 'agent:opencode' },
  { dir: 'codex', prefix: 'agent:codex' },
]

/**
 * 遞迴收集目錄內所有檔案的相對路徑（排序後回傳）
 */
function collectFiles(dir_path, base_path, skip_dirs) {
  const files = []

  for (const entry of readdirSync(dir_path, { withFileTypes: true })) {
    if (skip_dirs.has(entry.name)) {
      continue
    }

    const full_path = join(dir_path, entry.name)
    const rel_path = relative(base_path, full_path)

    if (entry.isDirectory()) {
      files.push(...collectFiles(full_path, base_path, skip_dirs))
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(rel_path)
    }
  }

  return files
}

export async function computeFileHash(file_path) {
  const content = readFileSync(file_path)
  return createHash('sha256').update(content).digest('hex')
}

export async function computeDirectoryHash(dir_path) {
  const files = collectFiles(dir_path, dir_path, SKIP_DIRS).sort()
  const hash = createHash('sha256')

  for (const rel_path of files) {
    const full_path = join(dir_path, rel_path)
    const stat = lstatSync(full_path)

    hash.update(rel_path)
    if (stat.isSymbolicLink()) {
      hash.update('symlink')
      hash.update(readlinkSync(full_path))
      continue
    }

    const content = readFileSync(full_path)
    hash.update(content)
  }

  return hash.digest('hex')
}

export async function computeSourceTreeHash(source_root) {
  const files = collectFiles(source_root, source_root, SOURCE_SKIP_DIRS).sort()
  const hash = createHash('sha256')

  for (const rel_path of files) {
    const full_path = join(source_root, rel_path)
    const stat = lstatSync(full_path)

    hash.update(rel_path)
    if (stat.isSymbolicLink()) {
      hash.update('symlink')
      hash.update(readlinkSync(full_path))
      continue
    }

    const content = readFileSync(full_path)
    hash.update(content)
  }

  return hash.digest('hex')
}

/**
 * 解析 unit key 到對應的檔案系統路徑，回傳 { path, type: 'file' | 'directory' }
 */
function resolveUnitPath(publish_root, unit_key) {
  const parts = unit_key.split(':')
  const category = parts[0]

  if (category === 'skill') {
    const name = parts[1]
    return { path: join(publish_root, 'skills', name), type: 'directory' }
  }

  if (category === 'agent') {
    const platform = parts[1]
    const name = parts[2]

    if (platform === 'claude') {
      return { path: join(publish_root, 'agents', `${name}.md`), type: 'file' }
    }
    if (platform === 'gemini') {
      return { path: join(publish_root, 'dist', 'gemini', 'agents', `${name}.md`), type: 'file' }
    }
    if (platform === 'opencode') {
      return { path: join(publish_root, 'dist', 'opencode', 'agents', `${name}.md`), type: 'file' }
    }
    if (platform === 'codex') {
      return { path: join(publish_root, 'dist', 'codex', 'agents', `${name}.toml`), type: 'file' }
    }
  }

  if (category === 'config') {
    const name = parts[1]
    return { path: join(publish_root, 'config', `${name}.json`), type: 'file' }
  }

  if (category === 'script') {
    const platform = parts[1]
    const name = parts[2]
    return { path: join(publish_root, 'scripts', platform, name), type: 'file' }
  }

  if (category === 'reference') {
    const name = parts[1]
    return { path: join(publish_root, 'references', name), type: 'file' }
  }

  if (category === 'policy') {
    const name = parts[1]
    return { path: join(publish_root, 'policies', name), type: 'file' }
  }

  throw new Error(`Unknown unit key: ${unit_key}`)
}

export async function computeUnitHash(publish_root, unit_key) {
  const { path, type } = resolveUnitPath(publish_root, unit_key)

  if (type === 'directory') {
    return computeDirectoryHash(path)
  }

  return computeFileHash(path)
}

export async function discoverUnits(publish_root) {
  const units = []

  // Skills — each subdirectory under skills/
  const skills_dir = join(publish_root, 'skills')
  if (existsSync(skills_dir)) {
    for (const entry of readdirSync(skills_dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        units.push(`skill:${entry.name}`)
      }
    }
  }

  // Claude agents — files under agents/
  const agents_dir = join(publish_root, 'agents')
  if (existsSync(agents_dir)) {
    for (const entry of readdirSync(agents_dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const name = entry.name.replace(/\.md$/, '')
        units.push(`agent:claude:${name}`)
      }
    }
  }

  // Platform agents under dist/{gemini,opencode,codex}/agents/
  for (const { dir, prefix } of DIST_AGENT_PLATFORMS) {
    const platform_agents_dir = join(publish_root, 'dist', dir, 'agents')
    if (!existsSync(platform_agents_dir)) {
      continue
    }

    for (const entry of readdirSync(platform_agents_dir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue
      }

      const name = entry.name.replace(/\.[^.]+$/, '')
      units.push(`${prefix}:${name}`)
    }
  }

  // Config — files under config/
  const config_dir = join(publish_root, 'config')
  if (existsSync(config_dir)) {
    for (const entry of readdirSync(config_dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        const name = entry.name.replace(/\.[^.]+$/, '')
        units.push(`config:${name}`)
      }
    }
  }

  // Scripts — files under scripts/{claude,opencode,shared}/
  const scripts_dir = join(publish_root, 'scripts')
  if (existsSync(scripts_dir)) {
    for (const platform_entry of readdirSync(scripts_dir, { withFileTypes: true })) {
      if (!platform_entry.isDirectory()) continue
      if (platform_entry.name.startsWith('_')) continue

      const platform_dir = join(scripts_dir, platform_entry.name)
      for (const entry of readdirSync(platform_dir, { withFileTypes: true })) {
        if (entry.isFile() && !isTestFile(entry.name)) {
          units.push(`script:${platform_entry.name}:${entry.name}`)
        }
      }
    }
  }

  // References — files under references/
  const references_dir = join(publish_root, 'references')
  if (existsSync(references_dir)) {
    for (const entry of readdirSync(references_dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        units.push(`reference:${entry.name}`)
      }
    }
  }

  // Policies — files under policies/
  const policies_dir = join(publish_root, 'policies')
  if (existsSync(policies_dir)) {
    for (const entry of readdirSync(policies_dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        units.push(`policy:${entry.name}`)
      }
    }
  }

  return units.sort()
}

export async function generateBuildManifest({ source_root, publish_root }) {
  const source_tree_hash = await computeSourceTreeHash(source_root)
  const unit_keys = await discoverUnits(publish_root)

  const units = {}
  for (const key of unit_keys) {
    const hash = await computeUnitHash(publish_root, key)
    const entry = { hash }

    if (COPY_IF_MISSING_UNITS.has(key)) {
      entry.strategy = 'copy-if-missing'
    }

    units[key] = entry
  }

  return {
    version: 1,
    sourceTreeHash: source_tree_hash,
    buildTime: new Date().toISOString(),
    units,
  }
}
