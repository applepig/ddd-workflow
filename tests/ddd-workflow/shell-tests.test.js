import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')

const DEFAULT_SHELL_TESTS = [
  {
    path: 'tests/ddd-workflow/scripts/claude/statusline.test.sh',
    timeout_ms: 30_000,
  },
  {
    path: 'tests/ddd-workflow/skills/ddd.xreview/scripts/adapters.test.sh',
    timeout_ms: 60_000,
  },
]

const FULL_SHELL_TESTS = [
  ...DEFAULT_SHELL_TESTS,
  {
    path: 'tests/ddd-workflow/skills/ddd.xreview/scripts/xreview-orchestrator.test.sh',
    timeout_ms: 180_000,
  },
]

const SHELL_TESTS = process.env.DDD_WORKFLOW_FULL_SHELL_TESTS === '1'
  ? FULL_SHELL_TESTS
  : DEFAULT_SHELL_TESTS

describe('ddd-workflow shell tests', () => {
  for (const test of SHELL_TESTS) {
    it(`runs ${test.path}`, () => {
      const result = spawnSync('bash', [test.path], {
        cwd: ROOT,
        encoding: 'utf8',
      })

      expect(result.status, result.stdout + result.stderr).toBe(0)
    }, test.timeout_ms)
  }
})
