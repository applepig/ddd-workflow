import { describe, it, expect } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import * as path from 'node:path'

const CLI_PATH = path.resolve(import.meta.dirname, 'main.ts')

function run(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      cwd: path.dirname(CLI_PATH),
      timeout: 10000,
    })
    return { stdout, stderr: '', exitCode: 0 }
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? 1,
    }
  }
}

describe('CLI routing (main.ts)', () => {
  describe('help command', () => {
    it('should display help text when called with "help"', () => {
      const result = run('help')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage: claude-r <command>')
    })

    it('should display help text when called with "--help"', () => {
      const result = run('--help')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage: claude-r <command>')
    })

    it('should display help text when called with "-h"', () => {
      const result = run('-h')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage: claude-r <command>')
    })
  })

  describe('unknown command', () => {
    it('should print error message and exit with code 1 for unknown command', () => {
      const result = run('badcommand')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Unknown command: badcommand')
    })

    it('should also display help text after unknown command error', () => {
      const result = run('badcommand')

      expect(result.stdout).toContain('Usage: claude-r <command>')
    })
  })

  describe('not-yet-implemented commands', () => {
    it('should start daemon and print started message for "daemon"', () => {
      // daemon 啟動後會進入無限 loop，用 spawnSync 配合短 timeout 來驗證啟動訊息
      const child = spawnSync('npx', ['tsx', CLI_PATH, 'daemon'], {
        encoding: 'utf-8',
        cwd: path.dirname(CLI_PATH),
        timeout: 3000,
      })
      const stdout = child.stdout || ''

      expect(stdout).toContain('claude-r daemon started')
    }, 10000)

    it('should route "install" to install command', () => {
      const result = run('install')

      // install calls systemctl which may fail in test env, but should not say "not yet implemented"
      expect(result.stderr).not.toContain('not yet implemented')
    })

    it('should route "uninstall" to uninstall command', () => {
      const result = run('uninstall')

      // uninstall calls systemctl which may fail in test env, but should not say "not yet implemented"
      expect(result.stderr).not.toContain('not yet implemented')
    })
  })

  describe('implemented commands show usage on missing args', () => {
    it('should show usage for "rm" without args', () => {
      const result = run('rm')
      expect(result.exitCode).toBe(1)
    })

    it('should show usage for "restart" without args', () => {
      const result = run('restart')
      expect(result.exitCode).toBe(1)
    })

    it('should show usage for "resume" without args', () => {
      const result = run('resume')
      expect(result.exitCode).toBe(1)
    })

    it('should show usage for "rename" without args', () => {
      const result = run('rename')
      expect(result.exitCode).toBe(1)
    })
  })

  describe('command aliases', () => {
    it('should accept "list" as alias for "ls"', () => {
      const result = run('list')
      expect(result.exitCode).toBe(0)
    })

    it('should accept "remove" as alias for "rm"', () => {
      const result = run('remove')
      expect(result.exitCode).toBe(1)
    })
  })
})
