import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  computeFileHash,
  computeDirectoryHash,
  computeSourceTreeHash,
  computeUnitHash,
  discoverUnits,
  generateBuildManifest,
} from './build-manifest.js'

function mkdtempLike(prefix) {
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

describe('computeFileHash', () => {
  let tmp_dir

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'manifest-file-'))
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should return SHA-256 hex string for a file', async () => {
    const file_path = join(tmp_dir, 'hello.txt')
    writeFileSync(file_path, 'hello world')

    const hash = await computeFileHash(file_path)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should return the same hash for the same content', async () => {
    const file_a = join(tmp_dir, 'a.txt')
    const file_b = join(tmp_dir, 'b.txt')
    writeFileSync(file_a, 'same content')
    writeFileSync(file_b, 'same content')

    const hash_a = await computeFileHash(file_a)
    const hash_b = await computeFileHash(file_b)

    expect(hash_a).toBe(hash_b)
  })

  it('should return different hashes for different content', async () => {
    const file_a = join(tmp_dir, 'a.txt')
    const file_b = join(tmp_dir, 'b.txt')
    writeFileSync(file_a, 'content A')
    writeFileSync(file_b, 'content B')

    const hash_a = await computeFileHash(file_a)
    const hash_b = await computeFileHash(file_b)

    expect(hash_a).not.toBe(hash_b)
  })
})

describe('computeDirectoryHash', () => {
  let tmp_dir

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'manifest-dir-'))
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should produce a deterministic hash regardless of filesystem order', async () => {
    const dir_a = join(tmp_dir, 'dir-a')
    const dir_b = join(tmp_dir, 'dir-b')
    mkdirSync(dir_a, { recursive: true })
    mkdirSync(dir_b, { recursive: true })

    // Write in different orders
    writeFileSync(join(dir_a, 'z.txt'), 'z-content')
    writeFileSync(join(dir_a, 'a.txt'), 'a-content')

    writeFileSync(join(dir_b, 'a.txt'), 'a-content')
    writeFileSync(join(dir_b, 'z.txt'), 'z-content')

    const hash_a = await computeDirectoryHash(dir_a)
    const hash_b = await computeDirectoryHash(dir_b)

    expect(hash_a).toBe(hash_b)
    expect(hash_a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should include nested files recursively', async () => {
    const dir = join(tmp_dir, 'nested')
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'root.txt'), 'root')
    writeFileSync(join(dir, 'sub', 'child.txt'), 'child')

    const hash = await computeDirectoryHash(dir)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should produce different hash when nested content changes', async () => {
    const dir = join(tmp_dir, 'change')
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'root.txt'), 'root')
    writeFileSync(join(dir, 'sub', 'child.txt'), 'version-1')

    const hash_v1 = await computeDirectoryHash(dir)

    writeFileSync(join(dir, 'sub', 'child.txt'), 'version-2')

    const hash_v2 = await computeDirectoryHash(dir)

    expect(hash_v1).not.toBe(hash_v2)
  })

  it('should skip .git directories', async () => {
    const dir = join(tmp_dir, 'with-git')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, 'file.txt'), 'content')
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main')

    const hash_with_git = await computeDirectoryHash(dir)

    // Create same dir without .git
    const dir_no_git = join(tmp_dir, 'no-git')
    mkdirSync(dir_no_git, { recursive: true })
    writeFileSync(join(dir_no_git, 'file.txt'), 'content')

    const hash_no_git = await computeDirectoryHash(dir_no_git)

    expect(hash_with_git).toBe(hash_no_git)
  })
})

describe('computeSourceTreeHash', () => {
  let tmp_dir
  let source_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'manifest-source-'))
    source_root = join(tmp_dir, 'src', 'ddd-workflow')
    mkdirSync(join(source_root, 'skills', 'ddd.work'), { recursive: true })
    mkdirSync(join(source_root, '_runtime'), { recursive: true })
    mkdirSync(join(source_root, '.git'), { recursive: true })
    writeFileSync(join(source_root, 'skills', 'ddd.work', 'SKILL.md'), '# skill')
    writeFileSync(join(source_root, '_runtime', 'private.sh'), 'secret')
    writeFileSync(join(source_root, '.git', 'HEAD'), 'ref: refs/heads/main')
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should skip _runtime and .git directories', async () => {
    const hash = await computeSourceTreeHash(source_root)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)

    // Changing _runtime should not affect the hash
    writeFileSync(join(source_root, '_runtime', 'private.sh'), 'changed secret')
    const hash_after_runtime_change = await computeSourceTreeHash(source_root)

    expect(hash).toBe(hash_after_runtime_change)
  })

  it('should change when source content changes', async () => {
    const hash_before = await computeSourceTreeHash(source_root)

    writeFileSync(join(source_root, 'skills', 'ddd.work', 'SKILL.md'), '# updated skill')

    const hash_after = await computeSourceTreeHash(source_root)

    expect(hash_before).not.toBe(hash_after)
  })

  it('should change when a source tree symlink target changes', async () => {
    writeFileSync(join(source_root, 'target-a.txt'), 'same content')
    writeFileSync(join(source_root, 'target-b.txt'), 'same content')
    symlinkSync('target-a.txt', join(source_root, 'current-link.txt'))

    const hash_before = await computeSourceTreeHash(source_root)

    rmSync(join(source_root, 'current-link.txt'), { force: true })
    symlinkSync('target-b.txt', join(source_root, 'current-link.txt'))

    const hash_after = await computeSourceTreeHash(source_root)

    expect(hash_before).not.toBe(hash_after)
  })
})

describe('computeUnitHash', () => {
  let tmp_dir
  let publish_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'manifest-unit-'))
    publish_root = join(tmp_dir, '.publish', 'ddd-workflow')

    // Build a realistic publish directory structure
    mkdirSync(join(publish_root, 'skills', 'ddd.work'), { recursive: true })
    mkdirSync(join(publish_root, 'agents'), { recursive: true })
    mkdirSync(join(publish_root, 'dist', 'gemini', 'agents'), { recursive: true })
    mkdirSync(join(publish_root, 'dist', 'opencode', 'agents'), { recursive: true })
    mkdirSync(join(publish_root, 'dist', 'codex', 'agents'), { recursive: true })
    mkdirSync(join(publish_root, 'config'), { recursive: true })
    mkdirSync(join(publish_root, 'scripts', 'claude'), { recursive: true })
    mkdirSync(join(publish_root, 'scripts', 'opencode'), { recursive: true })
    mkdirSync(join(publish_root, 'scripts', 'shared'), { recursive: true })
    mkdirSync(join(publish_root, 'references'), { recursive: true })
    mkdirSync(join(publish_root, 'policies'), { recursive: true })

    writeFileSync(join(publish_root, 'skills', 'ddd.work', 'SKILL.md'), '# skill')
    writeFileSync(join(publish_root, 'agents', 'ddd-developer.md'), '# agent')
    writeFileSync(join(publish_root, 'dist', 'gemini', 'agents', 'ddd-developer.md'), '# gemini agent')
    writeFileSync(join(publish_root, 'dist', 'opencode', 'agents', 'ddd-developer.md'), '# opencode agent')
    writeFileSync(join(publish_root, 'dist', 'codex', 'agents', 'ddd-developer.toml'), '# codex agent')
    writeFileSync(join(publish_root, 'config', 'xreview.json'), '{}')
    writeFileSync(join(publish_root, 'config', 'opencode-tui.json'), '{}')
    writeFileSync(join(publish_root, 'scripts', 'claude', 'statusline.sh'), '#!/bin/sh')
    writeFileSync(join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-capture.js'), 'code')
    writeFileSync(join(publish_root, 'scripts', 'shared', 'session-trigger.mjs'), 'code')
    writeFileSync(join(publish_root, 'references', 'AGENTS.md'), '# AGENTS')
    writeFileSync(join(publish_root, 'policies', 'ddd.xreview.toml'), '[policy]')
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should compute directory hash for skill unit', async () => {
    const hash = await computeUnitHash(publish_root, 'skill:ddd.work')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for claude agent unit', async () => {
    const hash = await computeUnitHash(publish_root, 'agent:claude:ddd-developer')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for gemini agent unit', async () => {
    const hash = await computeUnitHash(publish_root, 'agent:gemini:ddd-developer')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for opencode agent unit', async () => {
    const hash = await computeUnitHash(publish_root, 'agent:opencode:ddd-developer')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for codex agent unit', async () => {
    const hash = await computeUnitHash(publish_root, 'agent:codex:ddd-developer')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for config unit', async () => {
    const hash = await computeUnitHash(publish_root, 'config:xreview')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for script:claude unit', async () => {
    const hash = await computeUnitHash(publish_root, 'script:claude:statusline.sh')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for script:opencode unit', async () => {
    const hash = await computeUnitHash(publish_root, 'script:opencode:opencode-codex-usage-capture.js')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for script:shared unit', async () => {
    const hash = await computeUnitHash(publish_root, 'script:shared:session-trigger.mjs')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for reference unit', async () => {
    const hash = await computeUnitHash(publish_root, 'reference:AGENTS.md')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should compute file hash for policy unit', async () => {
    const hash = await computeUnitHash(publish_root, 'policy:ddd.xreview.toml')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should throw for unknown unit key format', async () => {
    await expect(computeUnitHash(publish_root, 'unknown:something'))
      .rejects.toThrow(/unknown unit key/i)
  })

  it('should throw for plugin unit key format (no longer supported)', async () => {
    await expect(computeUnitHash(publish_root, 'plugin:claude-plugin'))
      .rejects.toThrow(/unknown unit key/i)
  })
})

describe('discoverUnits', () => {
  let tmp_dir
  let publish_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'manifest-discover-'))
    publish_root = join(tmp_dir, '.publish', 'ddd-workflow')

    // Build a realistic publish directory
    mkdirSync(join(publish_root, 'skills', 'ddd.work'), { recursive: true })
    mkdirSync(join(publish_root, 'skills', 'ddd.plan'), { recursive: true })
    mkdirSync(join(publish_root, 'agents'), { recursive: true })
    mkdirSync(join(publish_root, 'dist', 'gemini', 'agents'), { recursive: true })
    mkdirSync(join(publish_root, 'dist', 'opencode', 'agents'), { recursive: true })
    mkdirSync(join(publish_root, 'dist', 'codex', 'agents'), { recursive: true })
    mkdirSync(join(publish_root, 'config'), { recursive: true })
    mkdirSync(join(publish_root, 'scripts', 'claude'), { recursive: true })
    mkdirSync(join(publish_root, 'scripts', 'opencode'), { recursive: true })
    mkdirSync(join(publish_root, 'scripts', 'shared'), { recursive: true })
    mkdirSync(join(publish_root, 'scripts', '_include'), { recursive: true })
    mkdirSync(join(publish_root, 'references'), { recursive: true })
    mkdirSync(join(publish_root, 'policies'), { recursive: true })
    mkdirSync(join(publish_root, '.claude-plugin'), { recursive: true })
    mkdirSync(join(publish_root, 'bin'), { recursive: true })
    mkdirSync(join(publish_root, '.git'), { recursive: true })

    writeFileSync(join(publish_root, 'skills', 'ddd.work', 'SKILL.md'), '# skill')
    writeFileSync(join(publish_root, 'skills', 'ddd.plan', 'SKILL.md'), '# plan')
    writeFileSync(join(publish_root, 'agents', 'ddd-developer.md'), '# agent')
    writeFileSync(join(publish_root, 'agents', 'ddd-reviewer.md'), '# reviewer')
    writeFileSync(join(publish_root, 'dist', 'gemini', 'agents', 'ddd-developer.md'), '# g')
    writeFileSync(join(publish_root, 'dist', 'gemini', 'agents', 'ddd-reviewer.md'), '# g')
    writeFileSync(join(publish_root, 'dist', 'opencode', 'agents', 'ddd-developer.md'), '# o')
    writeFileSync(join(publish_root, 'dist', 'opencode', 'agents', 'ddd-reviewer.md'), '# o')
    writeFileSync(join(publish_root, 'dist', 'codex', 'agents', 'ddd-developer.toml'), '# c')
    writeFileSync(join(publish_root, 'dist', 'codex', 'agents', 'ddd-reviewer.toml'), '# c')
    writeFileSync(join(publish_root, 'config', 'xreview.json'), '{}')
    writeFileSync(join(publish_root, 'config', 'opencode-tui.json'), '{}')
    writeFileSync(join(publish_root, 'scripts', 'claude', 'statusline.sh'), '#!/bin/sh')
    writeFileSync(join(publish_root, 'scripts', 'claude', 'statusline.test.js'), 'test')
    writeFileSync(join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-capture.js'), 'code')
    writeFileSync(join(publish_root, 'scripts', '_include', 'agent-runner.sh'), '#!/bin/sh')
    writeFileSync(join(publish_root, 'scripts', 'shared', 'session-trigger.mjs'), 'code')
    writeFileSync(join(publish_root, 'references', 'AGENTS.md'), '# AGENTS')
    writeFileSync(join(publish_root, 'policies', 'ddd.xreview.toml'), '[policy]')
    writeFileSync(join(publish_root, '.claude-plugin', 'plugin.json'), '{}')
    writeFileSync(join(publish_root, 'gemini-extension.json'), '{}')
    writeFileSync(join(publish_root, 'bin', 'transpile-agents.mjs'), 'bin')
    writeFileSync(join(publish_root, '.gitignore'), 'dist/')
    writeFileSync(join(publish_root, 'package.json'), '{}')
    writeFileSync(join(publish_root, 'README.md'), '# readme')
    writeFileSync(join(publish_root, 'LICENSE'), 'MIT')
    writeFileSync(join(publish_root, '.git', 'HEAD'), 'ref: refs/heads/main')
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should discover all skill units', async () => {
    const units = await discoverUnits(publish_root)
    expect(units).toContain('skill:ddd.work')
    expect(units).toContain('skill:ddd.plan')
  })

  it('should discover all claude agent units', async () => {
    const units = await discoverUnits(publish_root)
    expect(units).toContain('agent:claude:ddd-developer')
    expect(units).toContain('agent:claude:ddd-reviewer')
  })

  it('should discover all platform agent units', async () => {
    const units = await discoverUnits(publish_root)
    expect(units).toContain('agent:gemini:ddd-developer')
    expect(units).toContain('agent:gemini:ddd-reviewer')
    expect(units).toContain('agent:opencode:ddd-developer')
    expect(units).toContain('agent:opencode:ddd-reviewer')
    expect(units).toContain('agent:codex:ddd-developer')
    expect(units).toContain('agent:codex:ddd-reviewer')
  })

  it('should discover config units', async () => {
    const units = await discoverUnits(publish_root)
    expect(units).toContain('config:xreview')
    expect(units).toContain('config:opencode-tui')
  })

  it('should discover script units', async () => {
    const units = await discoverUnits(publish_root)
    expect(units).toContain('script:claude:statusline.sh')
    expect(units).toContain('script:opencode:opencode-codex-usage-capture.js')
    expect(units).toContain('script:shared:session-trigger.mjs')
  })

  it('should discover reference units', async () => {
    const units = await discoverUnits(publish_root)
    expect(units).toContain('reference:AGENTS.md')
  })

  it('should discover policy units', async () => {
    const units = await discoverUnits(publish_root)
    expect(units).toContain('policy:ddd.xreview.toml')
  })

  it('should exclude plugin metadata', async () => {
    const units = await discoverUnits(publish_root)
    expect(units).not.toContain('plugin:claude-plugin')
    expect(units).not.toContain('plugin:gemini-extension')
  })

  it('should exclude _include directories', async () => {
    // Add an _include directory with a script
    mkdirSync(join(publish_root, 'scripts', '_include'), { recursive: true })
    writeFileSync(join(publish_root, 'scripts', '_include', 'agent-runner.sh'), '#!/bin/sh')

    const units = await discoverUnits(publish_root)
    expect(units).not.toContain('script:_include:agent-runner.sh')
  })

  it('should exclude test files from scripts', async () => {
    const units = await discoverUnits(publish_root)
    expect(units).not.toContain('script:claude:statusline.test.js')
  })

  it('should exclude .git, .gitignore, package.json, README.md, LICENSE, bin/', async () => {
    const units = await discoverUnits(publish_root)
    const all_keys = units.join(' ')
    expect(all_keys).not.toContain('.git')
    expect(all_keys).not.toContain('.gitignore')
    expect(all_keys).not.toContain('package.json')
    expect(all_keys).not.toContain('README.md')
    expect(all_keys).not.toContain('LICENSE')
    expect(all_keys).not.toContain('bin/')
    expect(all_keys).not.toContain('transpile-agents')
  })

  it('should exclude dist/ at top level but include dist platform agent files', async () => {
    const units = await discoverUnits(publish_root)
    // Should not have a generic "dist" unit
    const dist_units = units.filter((u) => u.startsWith('dist:'))
    expect(dist_units).toHaveLength(0)
    // But platform agents should be discovered
    expect(units.filter((u) => u.startsWith('agent:gemini:'))).toHaveLength(2)
    expect(units.filter((u) => u.startsWith('agent:opencode:'))).toHaveLength(2)
    expect(units.filter((u) => u.startsWith('agent:codex:'))).toHaveLength(2)
  })

  it('should return sorted unit keys', async () => {
    const units = await discoverUnits(publish_root)
    const sorted = [...units].sort()
    expect(units).toEqual(sorted)
  })
})

describe('generateBuildManifest', () => {
  let tmp_dir
  let source_root
  let publish_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'manifest-gen-'))
    source_root = join(tmp_dir, 'src', 'ddd-workflow')
    publish_root = join(tmp_dir, '.publish', 'ddd-workflow')

    // Minimal source tree
    mkdirSync(join(source_root, 'skills', 'ddd.work'), { recursive: true })
    writeFileSync(join(source_root, 'skills', 'ddd.work', 'SKILL.md'), '# skill')

    // Minimal publish tree
    mkdirSync(join(publish_root, 'skills', 'ddd.work'), { recursive: true })
    mkdirSync(join(publish_root, 'agents'), { recursive: true })
    mkdirSync(join(publish_root, 'config'), { recursive: true })
    writeFileSync(join(publish_root, 'skills', 'ddd.work', 'SKILL.md'), '# skill')
    writeFileSync(join(publish_root, 'agents', 'ddd-test.md'), '# agent')
    writeFileSync(join(publish_root, 'config', 'xreview.json'), '{}')
    writeFileSync(join(publish_root, 'config', 'opencode-tui.json'), '{}')
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should produce a manifest with version, sourceTreeHash, buildTime, and units', async () => {
    const manifest = await generateBuildManifest({ source_root, publish_root })

    expect(manifest.version).toBe(1)
    expect(manifest.sourceTreeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(manifest.units).toBeDefined()
    expect(typeof manifest.units).toBe('object')
  })

  it('should include discovered units with their hashes', async () => {
    const manifest = await generateBuildManifest({ source_root, publish_root })

    expect(manifest.units['skill:ddd.work']).toBeDefined()
    expect(manifest.units['skill:ddd.work'].hash).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.units['agent:claude:ddd-test']).toBeDefined()
    expect(manifest.units['agent:claude:ddd-test'].hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should mark config:xreview with copy-if-missing strategy', async () => {
    const manifest = await generateBuildManifest({ source_root, publish_root })

    expect(manifest.units['config:xreview'].strategy).toBe('copy-if-missing')
  })

  it('should omit strategy for overwrite units', async () => {
    const manifest = await generateBuildManifest({ source_root, publish_root })

    expect(manifest.units['skill:ddd.work'].strategy).toBeUndefined()
    expect(manifest.units['agent:claude:ddd-test'].strategy).toBeUndefined()
  })

  it('should produce deterministic hashes for same content', async () => {
    const manifest_1 = await generateBuildManifest({ source_root, publish_root })
    const manifest_2 = await generateBuildManifest({ source_root, publish_root })

    expect(manifest_1.sourceTreeHash).toBe(manifest_2.sourceTreeHash)
    expect(manifest_1.units['skill:ddd.work'].hash).toBe(manifest_2.units['skill:ddd.work'].hash)
    // buildTime will differ, that's expected
  })
})
