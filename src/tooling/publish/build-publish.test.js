import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
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
import { buildPublish, guardCleanPublish, syncPublishTree, writePublishGitignore } from './build-publish.js'

function mkdtempLike(prefix) {
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function writeMinimalSource(source_root) {
  mkdirSync(join(source_root, 'agents'), { recursive: true })
  mkdirSync(join(source_root, 'scripts', 'shared'), { recursive: true })
  mkdirSync(join(source_root, 'skills', 'ddd.xreview', 'scripts'), { recursive: true })
  mkdirSync(join(source_root, '_runtime'), { recursive: true })
  writeFileSync(join(source_root, 'agents', 'ddd-test.md'), [
    '---',
    'name: ddd-test',
    'description: Test agent',
    'model: inherit',
    'color: blue',
    'tools:',
    '  - Read',
    '---',
    'Body',
    '',
  ].join('\n'))
  writeFileSync(join(source_root, 'scripts', 'shared', 'agent-runner.sh'), '#!/bin/sh\n')
  writeFileSync(join(source_root, '_runtime', 'private.sh'), 'private\n')
  symlinkSync('../../../scripts/shared/agent-runner.sh', join(source_root, 'skills', 'ddd.xreview', 'scripts', 'xreview-orchestrator.sh'))
}

describe('syncPublishTree', () => {
  let tmp_dir
  let source_root
  let publish_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'build-publish-'))
    source_root = join(tmp_dir, 'src', 'ddd-workflow')
    publish_root = join(tmp_dir, '.publish', 'ddd-workflow')
    writeMinimalSource(source_root)
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('skips source-only _runtime and dereferences skill-local symlinks', () => {
    syncPublishTree({ source_root, publish_root })

    expect(existsSync(join(publish_root, '_runtime'))).toBe(false)
    expect(readFileSync(join(publish_root, 'skills', 'ddd.xreview', 'scripts', 'xreview-orchestrator.sh'), 'utf8')).toBe('#!/bin/sh\n')
  })

  it('excludes authoring-only test files from the publish tree', () => {
    mkdirSync(join(source_root, 'scripts', '_include'), { recursive: true })
    mkdirSync(join(source_root, 'skills', 'ddd.work', 'scripts'), { recursive: true })
    writeFileSync(join(source_root, 'scripts', '_include', 'agent-runner.test.js'), 'test\n')
    writeFileSync(join(source_root, 'scripts', '_include', 'agent-runner.sh'), '#!/bin/sh\n')
    writeFileSync(join(source_root, 'skills', 'ddd.work', 'scripts', 'work.test.sh'), 'test\n')

    syncPublishTree({ source_root, publish_root })

    expect(existsSync(join(publish_root, 'scripts', '_include', 'agent-runner.sh'))).toBe(true)
    expect(existsSync(join(publish_root, 'scripts', '_include', 'agent-runner.test.js'))).toBe(false)
    expect(existsSync(join(publish_root, 'skills', 'ddd.work', 'scripts', 'work.test.sh'))).toBe(false)
  })
})

describe('writePublishGitignore', () => {
  let tmp_dir
  let publish_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'publish-gitignore-'))
    publish_root = join(tmp_dir, '.publish', 'ddd-workflow')
    mkdirSync(publish_root, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('ignores generated build manifest while preserving generated dist ignores', () => {
    writePublishGitignore({ publish_root })

    const lines = readFileSync(join(publish_root, '.gitignore'), 'utf8').split('\n')

    expect(lines).toEqual(expect.arrayContaining([
      'dist/',
      'node_modules/',
      '.build-manifest.json',
    ]))
  })
})

describe('buildPublish', () => {
  let tmp_dir
  let source_root
  let publish_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'build-publish-full-'))
    source_root = join(tmp_dir, 'src', 'ddd-workflow')
    publish_root = join(tmp_dir, '.publish', 'ddd-workflow')
    writeMinimalSource(source_root)
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('writes publish package metadata and platform agent dist', async () => {
    mkdirSync(publish_root, { recursive: true })
    spawnSync('git', ['init'], { cwd: publish_root })
    const tooling_dist_root = join(tmp_dir, 'dist', 'tooling')
    mkdirSync(join(tooling_dist_root, 'bin'), { recursive: true })
    mkdirSync(join(tooling_dist_root, 'chunks'), { recursive: true })
    mkdirSync(join(tooling_dist_root, 'deploy'), { recursive: true })
    writeFileSync(join(tooling_dist_root, 'bin', 'transpile-agents.mjs'), 'import "../chunks/agent-transpiler-test.mjs"\n')
    writeFileSync(join(tooling_dist_root, 'bin', 'deploy-agents.mjs'), 'import "../deploy/deploy-local.mjs"\n')
    writeFileSync(join(tooling_dist_root, 'chunks', 'agent-transpiler-test.mjs'), 'export const ok = true\n')
    writeFileSync(join(tooling_dist_root, 'deploy', 'deploy-local.mjs'), 'export const ok = true\n')

    await buildPublish({
      source_root,
      publish_root,
      tooling_dist_root,
      logger: { log() {} },
    })

    expect(existsSync(join(publish_root, 'package.json'))).toBe(true)
    expect(existsSync(join(publish_root, 'chunks'))).toBe(false)
    expect(existsSync(join(publish_root, 'deploy'))).toBe(false)
    expect(existsSync(join(publish_root, 'dist', 'gemini', 'agents', 'ddd-test.md'))).toBe(true)
    expect(existsSync(join(publish_root, 'dist', 'opencode', 'agents', 'ddd-test.md'))).toBe(true)
    expect(existsSync(join(publish_root, 'dist', 'codex', 'agents', 'ddd-test.toml'))).toBe(true)

    const transpile_bin = readFileSync(join(publish_root, 'bin', 'transpile-agents.mjs'), 'utf8')
    const deploy_bin = readFileSync(join(publish_root, 'bin', 'deploy-agents.mjs'), 'utf8')

    expect(transpile_bin).not.toMatch(/\.\.\/chunks/)
    expect(transpile_bin).not.toMatch(/from\s*["']gray-matter["']/)
    expect(deploy_bin).not.toMatch(/\.\.\/chunks/)
    expect(deploy_bin).not.toMatch(/\.\.\/deploy/)
  })

  it('should write .build-manifest.json after build', async () => {
    mkdirSync(publish_root, { recursive: true })
    spawnSync('git', ['init'], { cwd: publish_root })
    const tooling_dist_root = join(tmp_dir, 'dist', 'tooling')
    mkdirSync(join(tooling_dist_root, 'bin'), { recursive: true })
    mkdirSync(join(tooling_dist_root, 'chunks'), { recursive: true })
    mkdirSync(join(tooling_dist_root, 'deploy'), { recursive: true })
    writeFileSync(join(tooling_dist_root, 'bin', 'transpile-agents.mjs'), 'import "../chunks/agent-transpiler-test.mjs"\n')
    writeFileSync(join(tooling_dist_root, 'bin', 'deploy-agents.mjs'), 'import "../deploy/deploy-local.mjs"\n')
    writeFileSync(join(tooling_dist_root, 'chunks', 'agent-transpiler-test.mjs'), 'export const ok = true\n')
    writeFileSync(join(tooling_dist_root, 'deploy', 'deploy-local.mjs'), 'export const ok = true\n')

    await buildPublish({
      source_root,
      publish_root,
      tooling_dist_root,
      logger: { log() {} },
    })

    const manifest_path = join(publish_root, '.build-manifest.json')
    expect(existsSync(manifest_path)).toBe(true)

    const manifest = JSON.parse(readFileSync(manifest_path, 'utf8'))
    expect(manifest.version).toBe(1)
    expect(manifest.sourceTreeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(manifest.units).toBeDefined()
    expect(typeof manifest.units).toBe('object')
    expect(Object.keys(manifest.units).length).toBeGreaterThan(0)
  })

  it('fails when managed publish checkout is missing', async () => {
    await expect(buildPublish({
      source_root,
      publish_root,
      tooling_dist_root: join(tmp_dir, 'dist', 'tooling'),
      logger: { log() {} },
    })).rejects.toThrow(/請先執行 pnpm run publish:init/)
  })

  it('warns but does not throw on dirty managed publish checkout', () => {
    mkdirSync(publish_root, { recursive: true })
    spawnSync('git', ['init'], { cwd: publish_root })
    writeFileSync(join(publish_root, 'dirty.txt'), 'dirty')

    const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => guardCleanPublish({ publish_root })).not.toThrow()
    expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining('未提交變更'))
    warn_spy.mockRestore()
  })

  it('runs public bin entrypoints from the publish root', async () => {
    mkdirSync(publish_root, { recursive: true })
    spawnSync('git', ['init'], { cwd: publish_root })
    const tooling_dist_root = join(tmp_dir, 'dist', 'tooling')
    const build_result = spawnSync('node', ['scripts/build-tooling.js', '--outDir', tooling_dist_root], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(build_result.status, build_result.stderr || build_result.stdout).toBe(0)

    await buildPublish({
      source_root,
      publish_root,
      tooling_dist_root,
      logger: { log() {} },
    })
    rmSync(join(publish_root, 'dist'), { recursive: true, force: true })

    const transpile_bin = readFileSync(join(publish_root, 'bin', 'transpile-agents.mjs'), 'utf8')
    const deploy_bin = readFileSync(join(publish_root, 'bin', 'deploy-agents.mjs'), 'utf8')

    const transpile_result = spawnSync('node', ['bin/transpile-agents.mjs'], {
      cwd: publish_root,
      encoding: 'utf8',
    })
    const deploy_result = spawnSync('node', ['bin/deploy-agents.mjs', '--dry-run'], {
      cwd: publish_root,
      encoding: 'utf8',
    })

    expect(transpile_result.status, transpile_result.stderr || transpile_result.stdout).toBe(0)
    expect(existsSync(join(publish_root, 'dist', 'gemini', 'agents', 'ddd-test.md'))).toBe(true)
    expect(existsSync(join(publish_root, 'dist', 'opencode', 'agents', 'ddd-test.md'))).toBe(true)
    expect(existsSync(join(publish_root, 'dist', 'codex', 'agents', 'ddd-test.toml'))).toBe(true)
    expect(existsSync(join(publish_root, 'node_modules'))).toBe(false)
    expect(existsSync(join(publish_root, 'chunks'))).toBe(false)
    expect(existsSync(join(publish_root, 'deploy'))).toBe(false)
    expect(transpile_bin).not.toMatch(/\.\.\/chunks/)
    expect(transpile_bin).not.toMatch(/from\s*["']gray-matter["']/)
    expect(deploy_bin).not.toMatch(/\.\.\/chunks/)
    expect(deploy_bin).not.toMatch(/\.\.\/deploy/)
    expect(deploy_result.status, deploy_result.stderr || deploy_result.stdout).toBe(0)
    expect(deploy_result.stdout).toContain('[deploy-local] copy:')
  })
})
