import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

const mocked_exec = vi.mocked(execFileSync)

import {
  listSessions,
  attachSession,
  createSession,
  generateSessionName,
  PREFIX,
} from './tmux.ts'

/** Session 資訊型別 */
interface SessionInfo {
  name: string
  dir: string
}

describe('tmux module', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('PREFIX', () => {
    it('should be "cr-"', () => {
      expect(PREFIX).toBe('cr-')
    })
  })

  describe('listSessions', () => {
    it('should return session info with full name and directory', () => {
      mocked_exec.mockReturnValue(
        Buffer.from('cr-AGENTS:/home/user/projects/AGENTS\ncr-aistudio:/home/user/projects/aistudio\n'),
      )

      const result = listSessions()

      expect(result).toEqual([
        { name: 'cr-AGENTS', dir: '/home/user/projects/AGENTS' },
        { name: 'cr-aistudio', dir: '/home/user/projects/aistudio' },
      ])
    })

    it('should filter out non cr- sessions', () => {
      mocked_exec.mockReturnValue(
        Buffer.from('cr-AGENTS:/home/a\nother-session:/home/b\ncr-foo:/home/c\n'),
      )

      const result = listSessions()

      expect(result).toEqual([
        { name: 'cr-AGENTS', dir: '/home/a' },
        { name: 'cr-foo', dir: '/home/c' },
      ])
    })

    it('should return empty array when no tmux server is running', () => {
      mocked_exec.mockImplementation(() => {
        throw new Error('no server running on /tmp/tmux-1000/default')
      })

      const result = listSessions()

      expect(result).toEqual([])
    })

    it('should return empty array when no cr- sessions exist', () => {
      mocked_exec.mockReturnValue(Buffer.from('other-session:/tmp\nfoo-bar:/tmp\n'))

      const result = listSessions()

      expect(result).toEqual([])
    })

    it('should call tmux list-sessions with session_name and pane_current_path format', () => {
      mocked_exec.mockReturnValue(Buffer.from(''))

      listSessions()

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['list-sessions', '-F', '#{session_name}:#{pane_current_path}'],
        expect.any(Object),
      )
    })

    it('should handle empty output gracefully', () => {
      mocked_exec.mockReturnValue(Buffer.from(''))

      const result = listSessions()

      expect(result).toEqual([])
    })

    it('should handle lines without colon separator gracefully', () => {
      mocked_exec.mockReturnValue(Buffer.from('cr-broken\ncr-ok:/home/user\n'))

      const result = listSessions()

      // cr-broken has no dir, should still be included with empty dir
      // cr-ok has dir
      expect(result).toEqual([
        { name: 'cr-broken', dir: '' },
        { name: 'cr-ok', dir: '/home/user' },
      ])
    })
  })

  describe('attachSession', () => {
    it('should call tmux attach-session with full session name and stdio inherit', () => {
      attachSession('cr-AGENTS')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['attach-session', '-t', 'cr-AGENTS'],
        { stdio: 'inherit' },
      )
    })

    it('should throw when session does not exist', () => {
      mocked_exec.mockImplementation(() => {
        throw new Error('session not found: cr-nonexistent')
      })

      expect(() => attachSession('cr-nonexistent')).toThrow()
    })
  })

  describe('createSession', () => {
    it('should create detached tmux session with given name and directory', () => {
      createSession('cr-AGENTS', '/home/user/projects/AGENTS')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['new-session', '-d', '-s', 'cr-AGENTS', '-c', '/home/user/projects/AGENTS'],
        expect.any(Object),
      )
    })

    it('should send "claude --dangerously-skip-permissions" command via send-keys', () => {
      createSession('cr-AGENTS', '/home/user/projects/AGENTS')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['send-keys', '-t', 'cr-AGENTS', 'claude --dangerously-skip-permissions', 'Enter'],
        expect.any(Object),
      )
    })

    it('should call new-session before send-keys', () => {
      const call_order: string[] = []
      mocked_exec.mockImplementation((_cmd, args) => {
        const args_arr = args as string[]
        if (args_arr.includes('new-session')) call_order.push('new-session')
        if (args_arr.includes('send-keys')) call_order.push('send-keys')
        return Buffer.from('')
      })

      createSession('cr-test', '/tmp/test')

      expect(call_order).toEqual(['new-session', 'send-keys'])
    })
  })

  describe('generateSessionName', () => {
    it('should use directory basename with cr- prefix', () => {
      const result = generateSessionName('/home/user/projects/AGENTS', [])

      expect(result).toBe('cr-AGENTS')
    })

    it('should handle trailing slash in directory path', () => {
      const result = generateSessionName('/home/user/projects/AGENTS/', [])

      expect(result).toBe('cr-AGENTS')
    })

    it('should return base name when no conflicts', () => {
      const existing = [
        { name: 'cr-other', dir: '/tmp' },
      ]

      const result = generateSessionName('/home/user/projects/AGENTS', existing)

      expect(result).toBe('cr-AGENTS')
    })

    it('should add suffix when same name already exists', () => {
      const existing = [
        { name: 'cr-AGENTS', dir: '/other/path/AGENTS' },
      ]

      const result = generateSessionName('/home/user/projects/AGENTS', existing)

      expect(result).toMatch(/^cr-AGENTS-[a-z0-9]+$/)
      expect(result).not.toBe('cr-AGENTS')
    })

    it('should use root as basename for root directory', () => {
      const result = generateSessionName('/', [])

      // path.basename('/') returns '' on some platforms, handle gracefully
      expect(result).toMatch(/^cr-.+$/)
    })

    it('should handle home directory', () => {
      const result = generateSessionName('/home/user', [])

      expect(result).toBe('cr-user')
    })
  })
})
