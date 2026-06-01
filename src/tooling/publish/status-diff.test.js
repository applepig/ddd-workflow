import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { getPublishDiff } from './diff.js'
import { getPublishStatus } from './status.js'

function mkdtempLike(prefix) {
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout)
  }
  return result.stdout.trim()
}

describe('publish status and diff', () => {
  let tmp_dir
  let publish_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'publish-status-'))
    publish_root = join(tmp_dir, '.publish', 'ddd-workflow')
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('fails clearly when checkout is missing', () => {
    expect(() => getPublishStatus({ publish_root })).toThrow(/請先執行 pnpm run publish:init/)
    expect(() => getPublishDiff({ publish_root })).toThrow(/請先執行 pnpm run publish:init/)
  })

  it('returns branch-aware short status and diff stat for a managed checkout', () => {
    mkdirSync(publish_root, { recursive: true })
    runGit(['init'], { cwd: publish_root })
    writeFileSync(join(publish_root, 'README.md'), 'before\n')
    runGit(['add', 'README.md'], { cwd: publish_root })
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'initial'], { cwd: publish_root })
    writeFileSync(join(publish_root, 'README.md'), 'before\nafter\n')

    expect(getPublishStatus({ publish_root })).toContain('##')
    expect(getPublishStatus({ publish_root })).toContain(' M README.md')
    expect(getPublishDiff({ publish_root })).toContain('README.md')
  })
})
