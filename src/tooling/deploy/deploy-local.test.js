import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  applyDeployActions,
  parseArgs,
  planDeploy,
} from './deploy-local.js'

function mkdtempLike(prefix) {
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function writeFile(path, content) {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true })
  writeFileSync(path, content)
}

function writePublishFixture(publish_root) {
  writeFile(join(publish_root, 'references', 'AGENTS.md'), 'instructions\n')
  writeFile(join(publish_root, 'agents', 'ddd-developer.md'), 'claude developer\n')
  writeFile(join(publish_root, 'agents', 'ddd-reviewer.md'), 'claude reviewer\n')
  writeFile(join(publish_root, 'dist', 'gemini', 'agents', 'ddd-developer.md'), 'gemini developer\n')
  writeFile(join(publish_root, 'dist', 'codex', 'agents', 'ddd-developer.toml'), 'codex developer\n')
  writeFile(join(publish_root, 'dist', 'opencode', 'agents', 'ddd-developer.md'), 'opencode developer\n')
  writeFile(join(publish_root, 'policies', 'ddd.xreview.toml'), 'policy\n')
  writeFile(join(publish_root, 'config', 'xreview.json'), '{"reviewers":[]}\n')
  writeFile(join(publish_root, 'config', 'opencode-tui.json'), '{}\n')
  writeFile(join(publish_root, 'scripts', 'claude', 'statusline.sh'), '#!/bin/sh\n')
  writeFile(join(publish_root, 'scripts', 'shared', 'session-trigger.mjs'), 'console.log("tick")\n')
  writeFile(join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-capture.js'), 'capture\n')
  writeFile(join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-status.tsx'), 'status\n')
  writeFile(join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-format.js'), 'format\n')
}

describe('deploy-local fake HOME integration', () => {
  let tmp_dir
  let publish_root
  let home_dir

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'deploy-local-integration-'))
    publish_root = join(tmp_dir, 'publish')
    home_dir = join(tmp_dir, 'home')
    writePublishFixture(publish_root)
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('applies non-skill deploy actions into a /tmp fake HOME without symlinks', () => {
    const actions = planDeploy({
      publish_root,
      home_dir,
      include_skills: false,
    })

    applyDeployActions(actions, { logger: { log() {} } })

    expect(readFileSync(join(home_dir, '.claude', 'CLAUDE.md'), 'utf8')).toBe('instructions\n')
    expect(readFileSync(join(home_dir, '.gemini', 'agents', 'ddd-developer.md'), 'utf8')).toBe('gemini developer\n')
    expect(readFileSync(join(home_dir, '.codex', 'agents', 'ddd-developer.toml'), 'utf8')).toBe('codex developer\n')
    expect(readFileSync(join(home_dir, '.config', 'opencode', 'agents', 'ddd-developer.md'), 'utf8')).toBe('opencode developer\n')
    expect(readFileSync(join(home_dir, '.config', 'ddd-workflow', 'runtime', 'shared', 'session-trigger.mjs'), 'utf8')).toContain('tick')

    const symlink_scan = spawnSync('find', [home_dir, '-type', 'l'], { encoding: 'utf-8' })
    expect(symlink_scan.stdout).toBe('')
  })

  it('preserves existing user-editable xreview config', () => {
    const config_path = join(home_dir, '.config', 'ddd-workflow', 'xreview.json')
    writeFile(config_path, '{"reviewers":["custom"]}\n')

    const actions = planDeploy({
      publish_root,
      home_dir,
      include_skills: false,
    })

    applyDeployActions(actions, { logger: { log() {} } })

    expect(readFileSync(config_path, 'utf8')).toBe('{"reviewers":["custom"]}\n')
  })

  it('does not write to fake HOME during dry-run', () => {
    const actions = planDeploy({
      publish_root,
      home_dir,
      include_skills: false,
    })

    applyDeployActions(actions, { dry_run: true, logger: { log() {} } })

    expect(existsSync(home_dir)).toBe(false)
  })
})

describe('deploy-local CLI args', () => {
  it('supports fake HOME and skipping skills for isolated checks', () => {
    expect(parseArgs(['--home-dir', '/tmp/ddd-home', '--skip-skills', 'claude'])).toEqual({
      dry_run: false,
      home_dir: '/tmp/ddd-home',
      include_skills: false,
      targets: ['claude'],
    })
  })
})
