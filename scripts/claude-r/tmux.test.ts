import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

const mocked_exec = vi.mocked(execFileSync)

// Import after mock setup
import {
  createSession,
  killSession,
  listSessions,
  attachSession,
  sessionExists,
} from './tmux.ts'

describe('tmux module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createSession', () => {
    it('should call tmux new-session with cr- prefix, detached, and working directory', () => {
      createSession('my-project', '/home/user/projects/my-project', 'my-claude')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['new-session', '-d', '-s', 'cr-my-project', '-c', '/home/user/projects/my-project'],
        expect.any(Object),
      )
    })

    it('should send claude command with --dangerously-skip-permissions and --name via send-keys', () => {
      createSession('my-project', '/home/user/projects/my-project', 'my-claude')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['send-keys', '-t', 'cr-my-project', 'claude --dangerously-skip-permissions --name "my-claude"', 'Enter'],
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

      createSession('test', '/tmp/test', 'test-claude')

      expect(call_order).toEqual(['new-session', 'send-keys'])
    })
  })

  describe('killSession', () => {
    it('should call tmux kill-session with cr- prefix', () => {
      killSession('my-project')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['kill-session', '-t', 'cr-my-project'],
        expect.any(Object),
      )
    })

    it('should not throw when session does not exist', () => {
      mocked_exec.mockImplementation(() => {
        throw new Error('session not found: cr-nonexistent')
      })

      expect(() => killSession('nonexistent')).not.toThrow()
    })
  })

  describe('listSessions', () => {
    it('should parse tmux output and return only cr- prefixed sessions with prefix removed', () => {
      mocked_exec.mockReturnValue(Buffer.from('cr-alpha\ncr-beta\n'))

      const result = listSessions()

      expect(result).toEqual(['alpha', 'beta'])
    })

    it('should filter out non cr- sessions', () => {
      mocked_exec.mockReturnValue(Buffer.from('cr-alpha\nother-session\ncr-beta\nfoo\n'))

      const result = listSessions()

      expect(result).toEqual(['alpha', 'beta'])
    })

    it('should return empty array when no tmux server is running', () => {
      mocked_exec.mockImplementation(() => {
        throw new Error('no server running on /tmp/tmux-1000/default')
      })

      const result = listSessions()

      expect(result).toEqual([])
    })

    it('should return empty array when no cr- sessions exist', () => {
      mocked_exec.mockReturnValue(Buffer.from('other-session\nfoo-bar\n'))

      const result = listSessions()

      expect(result).toEqual([])
    })

    it('should call tmux list-sessions with correct format string', () => {
      mocked_exec.mockReturnValue(Buffer.from(''))

      listSessions()

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['list-sessions', '-F', '#{session_name}'],
        expect.any(Object),
      )
    })
  })

  describe('sessionExists', () => {
    it('should return true when tmux has-session succeeds', () => {
      mocked_exec.mockReturnValue(Buffer.from(''))

      const result = sessionExists('my-project')

      expect(result).toBe(true)
    })

    it('should return false when tmux has-session throws', () => {
      mocked_exec.mockImplementation(() => {
        throw new Error('session not found: cr-my-project')
      })

      const result = sessionExists('my-project')

      expect(result).toBe(false)
    })

    it('should call tmux has-session with cr- prefix', () => {
      mocked_exec.mockReturnValue(Buffer.from(''))

      sessionExists('test-session')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['has-session', '-t', 'cr-test-session'],
        expect.any(Object),
      )
    })
  })

  describe('attachSession', () => {
    it('should call tmux attach-session with cr- prefix and stdio inherit', () => {
      attachSession('my-project')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['attach-session', '-t', 'cr-my-project'],
        { stdio: 'inherit' },
      )
    })

    it('should throw when session does not exist', () => {
      mocked_exec.mockImplementation(() => {
        throw new Error('session not found: cr-nonexistent')
      })

      expect(() => attachSession('nonexistent')).toThrow()
    })
  })
})
