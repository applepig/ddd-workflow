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
  createSessionWithResume,
  getClaudeSessionId,
  killSession,
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

    it('should store a UUID as CLAUDE_SESSION_ID in tmux environment', () => {
      createSession('cr-AGENTS', '/home/user/projects/AGENTS')

      const set_env_call = mocked_exec.mock.calls.find(
        (call) => (call[1] as string[])[0] === 'set-environment',
      )
      expect(set_env_call).toBeDefined()
      const args = set_env_call![1] as string[]
      expect(args[0]).toBe('set-environment')
      expect(args[1]).toBe('-t')
      expect(args[2]).toBe('cr-AGENTS')
      expect(args[3]).toBe('CLAUDE_SESSION_ID')
      // UUID v4 format
      expect(args[4]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('should send claude command with --session-id flag including the UUID', () => {
      createSession('cr-AGENTS', '/home/user/projects/AGENTS')

      const send_keys_call = mocked_exec.mock.calls.find(
        (call) => (call[1] as string[])[0] === 'send-keys',
      )
      expect(send_keys_call).toBeDefined()
      const command_str = (send_keys_call![1] as string[])[3]
      expect(command_str).toMatch(/^claude --session-id [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} --dangerously-skip-permissions$/)
    })

    it('should use the same UUID in set-environment and send-keys', () => {
      createSession('cr-AGENTS', '/home/user/projects/AGENTS')

      const set_env_call = mocked_exec.mock.calls.find(
        (call) => (call[1] as string[])[0] === 'set-environment',
      )
      const send_keys_call = mocked_exec.mock.calls.find(
        (call) => (call[1] as string[])[0] === 'send-keys',
      )

      const env_uuid = (set_env_call![1] as string[])[4]
      const command_str = (send_keys_call![1] as string[])[3]
      expect(command_str).toContain(env_uuid)
    })

    it('should call new-session, then set-environment, then send-keys in order', () => {
      const call_order: string[] = []
      mocked_exec.mockImplementation((_cmd, args) => {
        const args_arr = args as string[]
        if (args_arr.includes('new-session')) call_order.push('new-session')
        if (args_arr.includes('set-environment')) call_order.push('set-environment')
        if (args_arr.includes('send-keys')) call_order.push('send-keys')
        return Buffer.from('')
      })

      createSession('cr-test', '/tmp/test')

      expect(call_order).toEqual(['new-session', 'set-environment', 'send-keys'])
    })
  })

  describe('getClaudeSessionId', () => {
    it('should return the UUID when CLAUDE_SESSION_ID is set', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      mocked_exec.mockReturnValue(Buffer.from(`CLAUDE_SESSION_ID=${uuid}\n`))

      const result = getClaudeSessionId('cr-AGENTS')

      expect(result).toBe(uuid)
      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['show-environment', '-t', 'cr-AGENTS', 'CLAUDE_SESSION_ID'],
        { stdio: 'pipe' },
      )
    })

    it('should return null when session does not exist', () => {
      mocked_exec.mockImplementation(() => {
        throw new Error('session not found: cr-nonexistent')
      })

      const result = getClaudeSessionId('cr-nonexistent')

      expect(result).toBeNull()
    })

    it('should return null when environment variable is not set', () => {
      mocked_exec.mockImplementation(() => {
        throw new Error('unknown variable: CLAUDE_SESSION_ID')
      })

      const result = getClaudeSessionId('cr-AGENTS')

      expect(result).toBeNull()
    })

    it('should return null when output has no equals sign', () => {
      mocked_exec.mockReturnValue(Buffer.from('CLAUDE_SESSION_ID\n'))

      const result = getClaudeSessionId('cr-AGENTS')

      expect(result).toBeNull()
    })

    it('should return null when value after equals sign is empty', () => {
      mocked_exec.mockReturnValue(Buffer.from('CLAUDE_SESSION_ID=\n'))

      const result = getClaudeSessionId('cr-AGENTS')

      expect(result).toBeNull()
    })

    it('should return null when value is not a valid UUID format', () => {
      mocked_exec.mockReturnValue(Buffer.from('CLAUDE_SESSION_ID=not-a-uuid\n'))

      const result = getClaudeSessionId('cr-AGENTS')

      expect(result).toBeNull()
    })

    it('should return null when value contains shell special characters', () => {
      mocked_exec.mockReturnValue(Buffer.from('CLAUDE_SESSION_ID=$(whoami)\n'))

      const result = getClaudeSessionId('cr-AGENTS')

      expect(result).toBeNull()
    })

    it('should return the UUID when value is a valid UUID format', () => {
      const valid_uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      mocked_exec.mockReturnValue(Buffer.from(`CLAUDE_SESSION_ID=${valid_uuid}\n`))

      const result = getClaudeSessionId('cr-AGENTS')

      expect(result).toBe(valid_uuid)
    })
  })

  describe('createSessionWithResume', () => {
    const resume_id = '550e8400-e29b-41d4-a716-446655440000'

    it('should create detached tmux session with given name and directory', () => {
      createSessionWithResume('cr-AGENTS', '/home/user/projects/AGENTS', resume_id)

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['new-session', '-d', '-s', 'cr-AGENTS', '-c', '/home/user/projects/AGENTS'],
        expect.any(Object),
      )
    })

    it('should store the resume_id as CLAUDE_SESSION_ID in tmux environment', () => {
      createSessionWithResume('cr-AGENTS', '/home/user/projects/AGENTS', resume_id)

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['set-environment', '-t', 'cr-AGENTS', 'CLAUDE_SESSION_ID', resume_id],
        expect.any(Object),
      )
    })

    it('should send claude command with --resume flag using the resume_id', () => {
      createSessionWithResume('cr-AGENTS', '/home/user/projects/AGENTS', resume_id)

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['send-keys', '-t', 'cr-AGENTS', `claude --resume ${resume_id} --dangerously-skip-permissions`, 'Enter'],
        expect.any(Object),
      )
    })

    it('should not include --session-id flag in the command', () => {
      createSessionWithResume('cr-AGENTS', '/home/user/projects/AGENTS', resume_id)

      const send_keys_call = mocked_exec.mock.calls.find(
        (call) => (call[1] as string[])[0] === 'send-keys',
      )
      const command_str = (send_keys_call![1] as string[])[3]
      expect(command_str).not.toContain('--session-id')
    })

    it('should call new-session, then set-environment, then send-keys in order', () => {
      const call_order: string[] = []
      mocked_exec.mockImplementation((_cmd, args) => {
        const args_arr = args as string[]
        if (args_arr.includes('new-session')) call_order.push('new-session')
        if (args_arr.includes('set-environment')) call_order.push('set-environment')
        if (args_arr.includes('send-keys')) call_order.push('send-keys')
        return Buffer.from('')
      })

      createSessionWithResume('cr-test', '/tmp/test', resume_id)

      expect(call_order).toEqual(['new-session', 'set-environment', 'send-keys'])
    })
  })

  describe('killSession', () => {
    it('should call tmux kill-session with target session name', () => {
      killSession('cr-AGENTS')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['kill-session', '-t', 'cr-AGENTS'],
        { stdio: 'pipe' },
      )
    })

    it('should throw when session does not exist', () => {
      mocked_exec.mockImplementation(() => {
        throw new Error('session not found: cr-nonexistent')
      })

      expect(() => killSession('cr-nonexistent')).toThrow()
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

    it('should replace dots in basename with underscores to avoid tmux target syntax conflict', () => {
      const result = generateSessionName('/home/user/.claude', [])

      expect(result).toBe('cr-_claude')
    })

    it('should replace all dots in basename with underscores', () => {
      const result = generateSessionName('/home/user/my.cool.project', [])

      expect(result).toBe('cr-my_cool_project')
    })

    it('should add suffix when dot-sanitized name already exists', () => {
      const existing = [
        { name: 'cr-_claude', dir: '/other/.claude' },
      ]

      const result = generateSessionName('/home/user/.claude', existing)

      expect(result).toMatch(/^cr-_claude-[a-z0-9]+$/)
      expect(result).not.toBe('cr-_claude')
    })
  })
})
