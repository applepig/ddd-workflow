import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { buildPublish, guardCleanPublish, syncPublishTree } from './build-publish.js'

function mkdtempLike(prefix) {
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function writeMinimalSource(source_root) {
  mkdirSync(join(source_root, 'agents'), { recursive: true })
  mkdirSync(join(source_root, 'scripts', 'shared'), { recursive: true })
  mkdirSync(join(source_root, 'skills', 'ddd.work', 'scripts'), { recursive: true })
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
  symlinkSync('../../../scripts/shared/agent-runner.sh', join(source_root, 'skills', 'ddd.work', 'scripts', 'work-orchestrator.sh'))
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
    expect(readFileSync(join(publish_root, 'skills', 'ddd.work', 'scripts', 'work-orchestrator.sh'), 'utf8')).toBe('#!/bin/sh\n')
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
    await buildPublish({
      source_root,
      publish_root,
      tooling_dist_root: join(tmp_dir, 'dist', 'tooling'),
      logger: { log() {} },
    })

    expect(existsSync(join(publish_root, 'package.json'))).toBe(true)
    expect(existsSync(join(publish_root, 'dist', 'gemini', 'agents', 'ddd-test.md'))).toBe(true)
    expect(existsSync(join(publish_root, 'dist', 'opencode', 'agents', 'ddd-test.md'))).toBe(true)
    expect(existsSync(join(publish_root, 'dist', 'codex', 'agents', 'ddd-test.toml'))).toBe(true)
  })

  it('fails dirty managed publish checkout unless forced', () => {
    mkdirSync(publish_root, { recursive: true })
    spawnSync('git', ['init'], { cwd: publish_root })
    writeFileSync(join(publish_root, 'dirty.txt'), 'dirty')

    expect(() => guardCleanPublish({ publish_root })).toThrow(/未提交變更/)
    expect(() => guardCleanPublish({ publish_root, allow_dirty: true })).not.toThrow()
  })
})
