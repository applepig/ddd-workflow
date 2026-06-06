import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

import {
  readBuildManifest,
  readDeployManifest,
  diffManifests,
  writeDeployManifest,
  buildDeployManifest,
  checkStaleBuild,
} from './deploy-manifest.js'

function mkdtempLike(prefix) {
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

describe('readBuildManifest', () => {
  let tmp_dir

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'deploy-manifest-'))
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should read and parse build manifest from publish root', () => {
    const publish_root = join(tmp_dir, '.publish', 'ddd-workflow')
    mkdirSync(publish_root, { recursive: true })

    const manifest = {
      version: 1,
      sourceTreeHash: 'abc123',
      buildTime: '2025-01-01T00:00:00.000Z',
      units: { 'skill:ddd.work': { hash: 'def456' } },
    }
    writeFileSync(join(publish_root, '.build-manifest.json'), JSON.stringify(manifest))

    const result = readBuildManifest(publish_root)

    expect(result).toEqual(manifest)
  })

  it('should throw when build manifest does not exist', () => {
    const publish_root = join(tmp_dir, 'nonexistent')

    expect(() => readBuildManifest(publish_root)).toThrow()
  })
})

describe('readDeployManifest', () => {
  let tmp_dir

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'deploy-manifest-'))
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should read and parse deploy manifest from path', () => {
    const manifest_path = join(tmp_dir, 'deploy.json')
    const manifest = {
      version: 1,
      deployedFrom: '/some/path',
      deployedAt: '2025-01-01T00:00:00.000Z',
      units: { 'skill:ddd.work': { hash: 'abc123', target: 'skills-cli' } },
    }
    writeFileSync(manifest_path, JSON.stringify(manifest))

    const result = readDeployManifest(manifest_path)

    expect(result).toEqual(manifest)
  })

  it('should return null when deploy manifest does not exist', () => {
    const manifest_path = join(tmp_dir, 'nonexistent', 'deploy.json')

    const result = readDeployManifest(manifest_path)

    expect(result).toBeNull()
  })
})

describe('diffManifests', () => {
  it('should mark new units as install', () => {
    const build_manifest = {
      version: 1,
      units: {
        'skill:ddd.work': { hash: 'abc123' },
      },
    }
    const deploy_manifest = {
      version: 1,
      units: {},
    }

    const diff = diffManifests(build_manifest, deploy_manifest, {
      checkTargetExists: () => false,
    })

    expect(diff).toContainEqual({
      unit: 'skill:ddd.work',
      action: 'install',
      reason: 'new unit',
    })
  })

  it('should mark unchanged units as skip', () => {
    const build_manifest = {
      version: 1,
      units: {
        'agent:claude:ddd-developer': { hash: 'same-hash' },
      },
    }
    const deploy_manifest = {
      version: 1,
      units: {
        'agent:claude:ddd-developer': { hash: 'same-hash' },
      },
    }

    const diff = diffManifests(build_manifest, deploy_manifest, {
      checkTargetExists: () => false,
    })

    expect(diff).toContainEqual({
      unit: 'agent:claude:ddd-developer',
      action: 'skip',
      reason: 'unchanged',
    })
  })

  it('should mark units with changed hash as install', () => {
    const build_manifest = {
      version: 1,
      units: {
        'skill:ddd.work': { hash: 'new-hash' },
      },
    }
    const deploy_manifest = {
      version: 1,
      units: {
        'skill:ddd.work': { hash: 'old-hash' },
      },
    }

    const diff = diffManifests(build_manifest, deploy_manifest, {
      checkTargetExists: () => false,
    })

    expect(diff).toContainEqual({
      unit: 'skill:ddd.work',
      action: 'install',
      reason: 'hash changed',
    })
  })

  it('should mark orphaned units as remove', () => {
    const build_manifest = {
      version: 1,
      units: {},
    }
    const deploy_manifest = {
      version: 1,
      units: {
        'policy:old-thing': { hash: 'abc123' },
      },
    }

    const diff = diffManifests(build_manifest, deploy_manifest, {
      checkTargetExists: () => false,
    })

    expect(diff).toContainEqual({
      unit: 'policy:old-thing',
      action: 'remove',
      reason: 'orphaned',
    })
  })

  it('should skip copy-if-missing units when target exists regardless of hash', () => {
    const build_manifest = {
      version: 1,
      units: {
        'config:xreview': { hash: 'new-hash', strategy: 'copy-if-missing' },
      },
    }
    const deploy_manifest = {
      version: 1,
      units: {
        'config:xreview': { hash: 'old-hash' },
      },
    }

    const diff = diffManifests(build_manifest, deploy_manifest, {
      checkTargetExists: (unit_key) => unit_key === 'config:xreview',
    })

    expect(diff).toContainEqual({
      unit: 'config:xreview',
      action: 'skip',
      reason: 'copy-if-missing, target exists',
    })
  })

  it('should install copy-if-missing units when target does not exist', () => {
    const build_manifest = {
      version: 1,
      units: {
        'config:xreview': { hash: 'new-hash', strategy: 'copy-if-missing' },
      },
    }
    const deploy_manifest = null

    const diff = diffManifests(build_manifest, deploy_manifest, {
      checkTargetExists: () => false,
    })

    expect(diff).toContainEqual({
      unit: 'config:xreview',
      action: 'install',
      reason: 'new unit',
    })
  })

  it('should treat all units as new when deploy_manifest is null', () => {
    const build_manifest = {
      version: 1,
      units: {
        'skill:ddd.work': { hash: 'abc' },
        'agent:claude:ddd-developer': { hash: 'def' },
        'config:xreview': { hash: 'ghi', strategy: 'copy-if-missing' },
      },
    }

    const diff = diffManifests(build_manifest, null, {
      checkTargetExists: () => false,
    })

    expect(diff).toHaveLength(3)
    expect(diff.every((e) => e.action === 'install')).toBe(true)
    expect(diff.every((e) => e.reason === 'new unit')).toBe(true)
  })

  it('should skip copy-if-missing units when deploy_manifest is null but target exists', () => {
    const build_manifest = {
      version: 1,
      units: {
        'config:xreview': { hash: 'ghi', strategy: 'copy-if-missing' },
      },
    }

    const diff = diffManifests(build_manifest, null, {
      checkTargetExists: () => true,
    })

    expect(diff).toContainEqual({
      unit: 'config:xreview',
      action: 'skip',
      reason: 'copy-if-missing, target exists',
    })
  })

  it('should handle mixed scenario with multiple unit types', () => {
    const build_manifest = {
      version: 1,
      units: {
        'skill:ddd.work': { hash: 'new-hash' },
        'skill:ddd.plan': { hash: 'same-hash' },
        'agent:claude:ddd-developer': { hash: 'brand-new' },
        'config:xreview': { hash: 'config-hash', strategy: 'copy-if-missing' },
      },
    }
    const deploy_manifest = {
      version: 1,
      units: {
        'skill:ddd.work': { hash: 'old-hash' },
        'skill:ddd.plan': { hash: 'same-hash' },
        'policy:removed': { hash: 'orphan-hash' },
      },
    }

    const diff = diffManifests(build_manifest, deploy_manifest, {
      checkTargetExists: (key) => key === 'config:xreview',
    })

    expect(diff).toContainEqual({ unit: 'skill:ddd.work', action: 'install', reason: 'hash changed' })
    expect(diff).toContainEqual({ unit: 'skill:ddd.plan', action: 'skip', reason: 'unchanged' })
    expect(diff).toContainEqual({ unit: 'agent:claude:ddd-developer', action: 'install', reason: 'new unit' })
    expect(diff).toContainEqual({ unit: 'config:xreview', action: 'skip', reason: 'copy-if-missing, target exists' })
    expect(diff).toContainEqual({ unit: 'policy:removed', action: 'remove', reason: 'orphaned' })
    expect(diff).toHaveLength(5)
  })
})

describe('writeDeployManifest', () => {
  let tmp_dir

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'deploy-manifest-write-'))
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should write manifest JSON to the specified path', () => {
    const manifest_path = join(tmp_dir, 'deploy.json')
    const manifest = {
      version: 1,
      deployedFrom: '/some/path',
      deployedAt: '2025-01-01T00:00:00.000Z',
      units: {},
    }

    writeDeployManifest(manifest_path, manifest)

    const content = JSON.parse(readFileSync(manifest_path, 'utf8'))
    expect(content).toEqual(manifest)
  })

  it('should automatically create parent directories', () => {
    const manifest_path = join(tmp_dir, 'deep', 'nested', 'dir', 'deploy.json')
    const manifest = { version: 1, units: {} }

    writeDeployManifest(manifest_path, manifest)

    expect(existsSync(manifest_path)).toBe(true)
    const content = JSON.parse(readFileSync(manifest_path, 'utf8'))
    expect(content).toEqual(manifest)
  })
})

describe('buildDeployManifest', () => {
  it('should produce a deploy manifest with version, deployedFrom, deployedAt, and units', () => {
    const units = {
      'skill:ddd.work': { hash: 'abc123', target: 'skills-cli' },
      'config:xreview': { hash: 'def456', target: '~/.config/ddd-workflow/xreview.json', skipped: true },
    }

    const result = buildDeployManifest({
      deploy_from: '/path/to/.publish/ddd-workflow',
      units,
    })

    expect(result.version).toBe(1)
    expect(result.deployedFrom).toBe('/path/to/.publish/ddd-workflow')
    expect(result.deployedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.units).toEqual(units)
  })

  it('should set deployedAt to current time', () => {
    const before = new Date().toISOString()

    const result = buildDeployManifest({
      deploy_from: '/some/path',
      units: {},
    })

    const after = new Date().toISOString()
    expect(result.deployedAt >= before).toBe(true)
    expect(result.deployedAt <= after).toBe(true)
  })
})

describe('checkStaleBuild', () => {
  let tmp_dir
  let source_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'stale-build-'))
    source_root = join(tmp_dir, 'src', 'ddd-workflow')
    mkdirSync(join(source_root, 'skills', 'ddd.work'), { recursive: true })
    writeFileSync(join(source_root, 'skills', 'ddd.work', 'SKILL.md'), '# skill content')
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should not throw when source hash matches build manifest', async () => {
    // Compute the actual source tree hash to put in the manifest
    const { computeSourceTreeHash } = await import('./build-manifest.js')
    const actual_hash = await computeSourceTreeHash(source_root)

    const build_manifest = {
      version: 1,
      sourceTreeHash: actual_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {},
    }

    // Should not throw
    await checkStaleBuild({ source_root, build_manifest })
  })

  it('should throw with pnpm run build hint when source hash differs', async () => {
    const build_manifest = {
      version: 1,
      sourceTreeHash: 'stale-hash-that-does-not-match',
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {},
    }

    await expect(
      checkStaleBuild({ source_root, build_manifest })
    ).rejects.toThrow(/pnpm run build/)
  })
})
