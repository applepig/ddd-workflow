import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  lstatSync,
  statSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { applyDeployActions, planDeploy } from '../../../../src/tooling/deploy/deploy-local.js'

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')
const SOURCE_ROOT = join(ROOT, 'src', 'ddd-workflow')
const RUNNER_PATH = join(SOURCE_ROOT, 'scripts', '_include', 'agent-runner.sh')
const SESSION_TRIGGER_PATH = join(SOURCE_ROOT, 'scripts', 'shared', 'session-trigger.mjs')
const XREVIEW_ENTRYPOINT = join(
  SOURCE_ROOT,
  'skills',
  'ddd.xreview',
  'scripts',
  'xreview-orchestrator.sh',
)

function getResolvedSymlinkTarget(link_path) {
  return resolve(join(link_path, '..'), readlinkSync(link_path))
}

function runBash(script_path, args = [], options = {}) {
  return spawnSync('bash', [script_path, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    ...options,
  })
}

describe('shared agent runner symlink layout', () => {
  it('should keep the cron session trigger script in the workflow scripts directory', () => {
    expect(existsSync(SESSION_TRIGGER_PATH)).toBe(true)
    expect(statSync(SESSION_TRIGGER_PATH).mode & 0o111).not.toBe(0)
  })

  it('should expose xreview orchestrator as a symlink to the shared runner', () => {
    expect(existsSync(XREVIEW_ENTRYPOINT)).toBe(true)
    expect(lstatSync(XREVIEW_ENTRYPOINT).isSymbolicLink()).toBe(true)
    expect(getResolvedSymlinkTarget(XREVIEW_ENTRYPOINT)).toBe(RUNNER_PATH)
  })

  it('should not expose legacy work orchestrator entrypoints after work parallelism moved to subagents', () => {
    expect(existsSync(join(SOURCE_ROOT, 'skills', 'ddd.work', 'scripts', 'work-orchestrator.sh'))).toBe(false)
    expect(existsSync(join(SOURCE_ROOT, 'skills', 'ddd.work', 'scripts', 'opencode-worker.sh'))).toBe(false)
  })
})

describe('agent runner mode dispatch', () => {
  let tmp_dir

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'agent-runner-dispatch-'))
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should dispatch xreview mode from xreview-orchestrator.sh invocation name', () => {
    const link_path = join(tmp_dir, 'xreview-orchestrator.sh')
    symlinkSync(RUNNER_PATH, link_path)

    const result = runBash(link_path, ['--help'])

    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).toContain('Usage: xreview-orchestrator.sh')
  })

  it('should reject legacy work mode from work-orchestrator.sh invocation name', () => {
    const link_path = join(tmp_dir, 'work-orchestrator.sh')
    symlinkSync(RUNNER_PATH, link_path)

    const result = runBash(link_path, ['--help'])

    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).toContain('Usage: agent-runner.sh --mode <xreview>')
  })

  it('should allow explicit xreview mode when invoking agent-runner.sh directly', () => {
    const result = runBash(RUNNER_PATH, ['--mode', 'xreview', '--help'])

    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).toContain('Usage: xreview-orchestrator.sh')
  })

  it('should reject explicit legacy work mode when invoking agent-runner.sh directly', () => {
    const result = runBash(RUNNER_PATH, ['--mode', 'work', '--help'])

    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).toContain('Usage: agent-runner.sh --mode <xreview>')
  })

  it('should reject direct agent-runner.sh invocation without --mode', () => {
    const result = runBash(RUNNER_PATH, ['--help'])

    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).toContain('Usage: agent-runner.sh --mode <xreview>')
  })
})

describe('deploy-local planner', () => {
  let home_dir

  beforeEach(() => {
    home_dir = mkdtempLike(join(tmpdir(), 'deploy-local-home-'))
  })

  afterEach(() => {
    rmSync(home_dir, { recursive: true, force: true })
  })

  it('should plan skills installation through repo-local skills CLI instead of symlink actions', () => {
    const actions = planDeploy({ publish_root: SOURCE_ROOT, home_dir, targets: ['claude'] })
    const command = actions.find((action) => action.type === 'command')

    expect(command.command).toBe('pnpm')
    expect(command.args).toEqual(expect.arrayContaining(['exec', 'skills', 'add', SOURCE_ROOT]))
    expect(actions.some((action) => action.type === 'copy' && action.target.includes('/skills/'))).toBe(false)
  })

  it('should copy session-trigger as generated runtime without writing during dry-run', () => {
    const actions = planDeploy({ publish_root: SOURCE_ROOT, home_dir, targets: ['claude'] })
    const runtime_action = actions.find((action) => action.target?.endsWith('runtime/shared/session-trigger.mjs'))

    expect(runtime_action.source).toBe(SESSION_TRIGGER_PATH)
    applyDeployActions(actions, { dry_run: true, logger: { log() {} } })
    expect(existsSync(runtime_action.target)).toBe(false)
  })
})

function mkdtempLike(prefix) {
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], {
    encoding: 'utf-8',
  })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
