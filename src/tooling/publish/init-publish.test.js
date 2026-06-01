import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { initPublish } from './init-publish.js'

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

describe('initPublish', () => {
  let tmp_dir
  let publish_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'init-publish-'))
    publish_root = join(tmp_dir, '.publish', 'ddd-workflow')
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('fails when publish root is a non-empty non-Git directory', () => {
    mkdirSync(publish_root, { recursive: true })
    writeFileSync(join(publish_root, 'notes.txt'), 'keep me')

    expect(() => initPublish({ publish_root })).toThrow(/非空目錄.*不是 Git checkout/)
    expect(readFileSync(join(publish_root, 'notes.txt'), 'utf8')).toBe('keep me')
  })

  it('keeps existing Git checkout files and adds missing origin remote', () => {
    mkdirSync(publish_root, { recursive: true })
    runGit(['init'], { cwd: publish_root })
    writeFileSync(join(publish_root, 'kept.txt'), 'do not delete')

    initPublish({
      publish_root,
      repo_url: 'https://example.test/ddd-workflow.git',
      logger: { log() {} },
    })

    expect(existsSync(join(publish_root, 'kept.txt'))).toBe(true)
    expect(runGit(['remote', 'get-url', 'origin'], { cwd: publish_root })).toBe('https://example.test/ddd-workflow.git')
  })
})
