import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  lstatSync,
  statSync,
  readFileSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const RUNNER_PATH = join(ROOT, 'ddd-workflow', 'scripts', 'agent-runner.sh')
const SESSION_TRIGGER_PATH = join(ROOT, 'ddd-workflow', 'scripts', 'session-trigger.mjs')
const XREVIEW_ENTRYPOINT = join(
  ROOT,
  'ddd-workflow',
  'skills',
  'ddd.xreview',
  'scripts',
  'xreview-orchestrator.sh',
)
const WORK_ENTRYPOINT = join(
  ROOT,
  'ddd-workflow',
  'skills',
  'ddd.work',
  'scripts',
  'work-orchestrator.sh',
)
const WORKER_ENTRYPOINT = join(
  ROOT,
  'ddd-workflow',
  'skills',
  'ddd.work',
  'scripts',
  'opencode-worker.sh',
)
const OPENCODE_ADAPTER_PATH = join(
  ROOT,
  'ddd-workflow',
  'skills',
  'ddd.xreview',
  'scripts',
  'adapters',
  'opencode.sh',
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

function createInstalledClaudeFixture(home_dir) {
  const claude_dir = join(home_dir, '.claude')
  const scripts_dir = join(claude_dir, 'scripts')
  mkdirSync(scripts_dir, { recursive: true })
  symlinkSync(
    join(ROOT, 'ddd-workflow', 'references', 'AGENTS.md'),
    join(claude_dir, 'CLAUDE.md'),
  )
  symlinkSync(
    join(ROOT, 'ddd-workflow', 'scripts', 'statusline.sh'),
    join(scripts_dir, 'statusline.sh'),
  )
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

  it('should expose work orchestrator as a symlink to the shared runner', () => {
    expect(existsSync(WORK_ENTRYPOINT)).toBe(true)
    expect(lstatSync(WORK_ENTRYPOINT).isSymbolicLink()).toBe(true)
    expect(getResolvedSymlinkTarget(WORK_ENTRYPOINT)).toBe(RUNNER_PATH)
  })

  it('should expose opencode worker as a skill-local symlink to the shared adapter', () => {
    expect(existsSync(WORKER_ENTRYPOINT)).toBe(true)
    expect(lstatSync(WORKER_ENTRYPOINT).isSymbolicLink()).toBe(true)
    expect(getResolvedSymlinkTarget(WORKER_ENTRYPOINT)).toBe(OPENCODE_ADAPTER_PATH)
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

  it('should dispatch work mode from work-orchestrator.sh invocation name', () => {
    const link_path = join(tmp_dir, 'work-orchestrator.sh')
    symlinkSync(RUNNER_PATH, link_path)

    const result = runBash(link_path, ['--help'])

    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).toContain('Usage: work-orchestrator.sh')
  })

  it('should allow explicit xreview mode when invoking agent-runner.sh directly', () => {
    const result = runBash(RUNNER_PATH, ['--mode', 'xreview', '--help'])

    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).toContain('Usage: xreview-orchestrator.sh')
  })

  it('should allow explicit work mode when invoking agent-runner.sh directly', () => {
    const result = runBash(RUNNER_PATH, ['--mode', 'work', '--help'])

    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).toContain('Usage: work-orchestrator.sh')
  })

  it('should reject direct agent-runner.sh invocation without --mode', () => {
    const result = runBash(RUNNER_PATH, ['--help'])

    expect(result.status).toBe(2)
    expect(result.stdout + result.stderr).toContain('Usage: agent-runner.sh --mode <xreview|work>')
  })
})

describe('cli test validation for skill-local script symlinks', () => {
  let home_dir

  beforeEach(() => {
    home_dir = mkdtempLike(join(tmpdir(), 'agents-cli-home-'))
    createInstalledClaudeFixture(home_dir)
  })

  afterEach(() => {
    rmSync(home_dir, { recursive: true, force: true })
  })

  it('should fail npm test when installed skills directory is missing', () => {
    const result = spawnSync('node', ['scripts/cli.js', 'test', 'claude'], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, HOME: home_dir },
    })

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain(
      '~/.claude/skills: installed skills directory missing',
    )
  })

  it('should fail npm test when required installed skill-local scripts are missing', () => {
    mkdirSync(join(home_dir, '.claude', 'skills', 'ddd.xreview', 'scripts'), { recursive: true })
    mkdirSync(join(home_dir, '.claude', 'skills', 'ddd.work', 'scripts'), { recursive: true })

    const result = spawnSync('node', ['scripts/cli.js', 'test', 'claude'], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, HOME: home_dir },
    })

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain(
      'skill-local script ddd.work/scripts/work-orchestrator.sh missing',
    )
    expect(result.stdout + result.stderr).toContain(
      'skill-local script ddd.xreview/scripts/xreview-orchestrator.sh missing',
    )
  })
})

describe('work orchestrator mode', () => {
  let tmp_dir

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'work-orchestrator-'))
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should run two JSONL jobs and emit job-level START, RETURN, and ALL_DONE events', () => {
    const mock_worker = createMockWorker(`
worker_result=$(mktemp -t mock-worker-result-XXXXXX.txt)
printf 'DONE: %s completed\\n' "$description" > "$worker_result"
printf '[opencode-worker] DESCRIPTION %s\\n' "$description"
printf '[opencode-worker] RESULT_FILE %s\\n' "$worker_result"
printf '[opencode-worker] DONE exit=0\\n'
`)
    const prompt_a = writePromptFile('prompt-a.md', 'Implement A')
    const prompt_b = writePromptFile('prompt-b.md', 'Implement B')
    const jobs_file = writeJobsFile([
      { id: 'A', description: 'Alpha job', prompt_file: prompt_a },
      { id: 'B', description: 'Beta job', prompt_file: prompt_b },
    ])

    const result = runWorkOrchestrator(jobs_file, mock_worker)

    expect(result.status).toBe(0)
    const events = getEventLines(result.stdout)
    expect(events.at(-1)).toBe('ALL_DONE')
    expect(events.filter((line) => line.startsWith('START '))).toHaveLength(2)
    expect(events.filter((line) => line.startsWith('RETURN '))).toHaveLength(2)
    expect(events).toEqual(expect.arrayContaining([
      expect.stringMatching(/^START A \/tmp\/ddd-worker-[^ ]+\.log \/tmp\/ddd-worker-[^ ]+\.result\.txt$/),
      expect.stringMatching(/^START B \/tmp\/ddd-worker-[^ ]+\.log \/tmp\/ddd-worker-[^ ]+\.result\.txt$/),
      expect.stringMatching(/^RETURN A \/tmp\/ddd-worker-[^ ]+\.log \/tmp\/ddd-worker-[^ ]+\.result\.txt$/),
      expect.stringMatching(/^RETURN B \/tmp\/ddd-worker-[^ ]+\.log \/tmp\/ddd-worker-[^ ]+\.result\.txt$/),
    ]))
    expect(result.stdout).not.toContain('[opencode-worker]')

    for (const job_id of ['A', 'B']) {
      const start_event = events.find((line) => line.startsWith(`START ${job_id} `))
      const [, , log_path, result_path] = start_event.split(' ')
      expect(readFileSync(log_path, 'utf-8')).toContain('[opencode-worker] DESCRIPTION')
      expect(readFileSync(log_path, 'utf-8')).toContain('[opencode-worker] DONE exit=0')
      expect(readFileSync(result_path, 'utf-8')).toContain('DONE:')
    }
  })

  it('should emit FAIL for one failed worker while other jobs continue', () => {
    const mock_worker = createMockWorker(`
worker_result=$(mktemp -t mock-worker-result-XXXXXX.txt)
printf 'DONE: %s completed\\n' "$description" > "$worker_result"
printf '[opencode-worker] DESCRIPTION %s\\n' "$description"
printf '[opencode-worker] RESULT_FILE %s\\n' "$worker_result"
if [[ "$description" == *Failing* ]]; then
  printf '[opencode-worker] DONE exit=7\\n' >&2
  exit 7
fi
printf '[opencode-worker] DONE exit=0\\n'
`)
    const jobs_file = writeJobsFile([
      { id: 'A', description: 'Passing job', prompt_file: writePromptFile('pass.md', 'pass') },
      { id: 'B', description: 'Failing job', prompt_file: writePromptFile('fail.md', 'fail') },
    ])

    const result = runWorkOrchestrator(jobs_file, mock_worker)

    expect(result.status).toBe(0)
    const events = getEventLines(result.stdout)
    expect(events).toEqual(expect.arrayContaining([
      expect.stringMatching(/^RETURN A /),
      expect.stringMatching(/^FAIL B exit_code=7 log=\/tmp\/ddd-worker-[^ ]+\.log result=\/tmp\/ddd-worker-[^ ]+\.result\.txt$/),
      'ALL_DONE',
    ]))
    expect(result.stdout).not.toContain('[opencode-worker]')
    const fail_event = events.find((line) => line.startsWith('FAIL B '))
    const log_path = fail_event.match(/ log=([^ ]+)/)[1]
    expect(readFileSync(log_path, 'utf-8')).toContain('[opencode-worker] DONE exit=7')
  })

  it('should fail timed out workers with exit_code 124', () => {
    const mock_worker = createMockWorker(`
printf '[opencode-worker] DESCRIPTION %s\\n' "$description"
sleep 2
printf '[opencode-worker] DONE exit=0\\n'
`)
    const jobs_file = writeJobsFile([
      { id: 'T', description: 'Timeout job', prompt_file: writePromptFile('timeout.md', 'timeout') },
    ])

    const result = runWorkOrchestrator(jobs_file, mock_worker, {
      DDD_WORK_TIMEOUT_SEC: '1',
    })

    expect(result.status).toBe(0)
    const events = getEventLines(result.stdout)
    expect(events).toEqual(expect.arrayContaining([
      expect.stringMatching(/^FAIL T exit_code=124 log=\/tmp\/ddd-worker-[^ ]+\.log result=\/tmp\/ddd-worker-[^ ]+\.result\.txt$/),
      'ALL_DONE',
    ]))
    const fail_event = events.find((line) => line.startsWith('FAIL T '))
    const result_path = fail_event.match(/ result=([^ ]+)/)[1]
    expect(existsSync(result_path)).toBe(true)
    expect(readFileSync(result_path, 'utf-8')).toBe('')
  })

  function writePromptFile(file_name, content) {
    const file_path = join(tmp_dir, file_name)
    writeFileSync(file_path, content)
    return file_path
  }

  function writeJobsFile(jobs) {
    const jobs_file = join(tmp_dir, 'jobs.jsonl')
    writeFileSync(jobs_file, jobs.map((job) => JSON.stringify(job)).join('\n') + '\n')
    return jobs_file
  }

  function createMockWorker(body) {
    const mock_worker = join(tmp_dir, 'mock-worker.sh')
    writeFileSync(mock_worker, `#!/usr/bin/env bash
set -uo pipefail
description=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --description) description="$2"; shift 2 ;;
    --subagent-type|--model|--isolation|--prompt-file|--cwd) shift 2 ;;
    *) shift ;;
  esac
done
${body}
`)
    spawnSync('chmod', ['755', mock_worker])
    return mock_worker
  }
})

function runWorkOrchestrator(jobs_file, worker_script, env = {}) {
  return runBash(WORK_ENTRYPOINT, ['--jobs-file', jobs_file, '--cwd', ROOT], {
    env: {
      ...process.env,
      DDD_AGENT_RUNNER_WORKER_SCRIPT: worker_script,
      ...env,
    },
  })
}

function getEventLines(stdout) {
  return stdout.trim().split('\n').filter(Boolean)
}

function mkdtempLike(prefix) {
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], {
    encoding: 'utf-8',
  })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
