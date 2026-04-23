import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/user'),
}))

const mocked_exec = vi.mocked(execFileSync)
const mocked_read_file = vi.mocked(readFileSync)
const mocked_exists = vi.mocked(existsSync)
const mocked_homedir = vi.mocked(homedir)

import {
  listSessions,
  attachSession,
  createSession,
  createSessionWithResume,
  getClaudeSessionId,
  killSession,
  generateSessionName,
  syncSessionId,
  sessionFileExists,
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
        { stdio: 'pipe' },
      )
    })

    it('should send cc command via send-keys', () => {
      createSession('cr-AGENTS', '/home/user/projects/AGENTS')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['send-keys', '-t', 'cr-AGENTS', 'cc', 'Enter'],
        { stdio: 'pipe' },
      )
    })

    it('should not call set-environment', () => {
      createSession('cr-AGENTS', '/home/user/projects/AGENTS')

      const set_env_call = mocked_exec.mock.calls.find(
        (call) => (call[1] as string[])[0] === 'set-environment',
      )
      expect(set_env_call).toBeUndefined()
    })

    it('should not include --session-id in the command', () => {
      createSession('cr-AGENTS', '/home/user/projects/AGENTS')

      const send_keys_call = mocked_exec.mock.calls.find(
        (call) => (call[1] as string[])[0] === 'send-keys',
      )
      expect(send_keys_call).toBeDefined()
      const command_str = (send_keys_call![1] as string[])[3]
      expect(command_str).not.toContain('--session-id')
    })

    it('should call new-session then send-keys in order', () => {
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

    it('should only make two execFileSync calls', () => {
      createSession('cr-test', '/tmp/test')

      expect(mocked_exec).toHaveBeenCalledTimes(2)
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
        { stdio: 'pipe' },
      )
    })

    it('should store the resume_id as CLAUDE_SESSION_ID in tmux environment', () => {
      createSessionWithResume('cr-AGENTS', '/home/user/projects/AGENTS', resume_id)

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['set-environment', '-t', 'cr-AGENTS', 'CLAUDE_SESSION_ID', resume_id],
        { stdio: 'pipe' },
      )
    })

    it('should send cc --resume command with the resume_id', () => {
      createSessionWithResume('cr-AGENTS', '/home/user/projects/AGENTS', resume_id)

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['send-keys', '-t', 'cr-AGENTS', `cc --resume ${resume_id}`, 'Enter'],
        { stdio: 'pipe' },
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

  describe('syncSessionId', () => {
    it('should read pane PID, find child process, read session file, and set tmux environment', () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      mocked_exec
        .mockReturnValueOnce(Buffer.from('12345\n'))   // display-message → pane_pid
        .mockReturnValueOnce(Buffer.from('67890\n'))   // pgrep → child PID
        .mockReturnValueOnce(Buffer.from(''))          // set-environment
      mocked_read_file.mockReturnValueOnce(JSON.stringify({ sessionId: uuid }))

      syncSessionId('cr-AGENTS')

      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['display-message', '-t', 'cr-AGENTS', '-p', '#{pane_pid}'],
        { stdio: 'pipe' },
      )
      expect(mocked_exec).toHaveBeenCalledWith(
        'pgrep',
        ['-P', '12345'],
        { stdio: 'pipe' },
      )
      expect(mocked_read_file).toHaveBeenCalledWith(
        '/home/user/.claude/sessions/67890.json',
        'utf-8',
      )
      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['set-environment', '-t', 'cr-AGENTS', 'CLAUDE_SESSION_ID', uuid],
        { stdio: 'pipe' },
      )
    })

    it('should try multiple child PIDs until finding a valid session file', () => {
      const uuid = 'deadbeef-1234-5678-9abc-def012345678'
      mocked_exec
        .mockReturnValueOnce(Buffer.from('100\n'))       // display-message → pane_pid
        .mockReturnValueOnce(Buffer.from('200\n300\n'))  // pgrep → two children
        .mockReturnValueOnce(Buffer.from(''))            // set-environment
      mocked_read_file
        .mockImplementationOnce(() => { throw new Error('ENOENT') })  // 200.json missing
        .mockReturnValueOnce(JSON.stringify({ sessionId: uuid }))      // 300.json found

      syncSessionId('cr-test')

      expect(mocked_read_file).toHaveBeenCalledWith(
        '/home/user/.claude/sessions/200.json',
        'utf-8',
      )
      expect(mocked_read_file).toHaveBeenCalledWith(
        '/home/user/.claude/sessions/300.json',
        'utf-8',
      )
      expect(mocked_exec).toHaveBeenCalledWith(
        'tmux',
        ['set-environment', '-t', 'cr-test', 'CLAUDE_SESSION_ID', uuid],
        { stdio: 'pipe' },
      )
    })

    it('should silently skip when pane PID cannot be obtained', () => {
      mocked_exec.mockImplementationOnce(() => { throw new Error('no session') })

      expect(() => syncSessionId('cr-missing')).not.toThrow()
      expect(mocked_read_file).not.toHaveBeenCalled()
    })

    it('should silently skip when pgrep finds no children', () => {
      mocked_exec
        .mockReturnValueOnce(Buffer.from('12345\n'))  // display-message
        .mockImplementationOnce(() => { throw new Error('no children') })  // pgrep fails

      expect(() => syncSessionId('cr-test')).not.toThrow()
      expect(mocked_read_file).not.toHaveBeenCalled()
    })

    it('should silently skip when no session file has a valid UUID', () => {
      mocked_exec
        .mockReturnValueOnce(Buffer.from('100\n'))   // display-message
        .mockReturnValueOnce(Buffer.from('200\n'))   // pgrep
      mocked_read_file.mockReturnValueOnce(JSON.stringify({ sessionId: 'not-a-uuid' }))

      expect(() => syncSessionId('cr-test')).not.toThrow()
      // Should not call set-environment since UUID is invalid
      const set_env_call = mocked_exec.mock.calls.find(
        (call) => call[0] === 'tmux' && (call[1] as string[])[0] === 'set-environment',
      )
      expect(set_env_call).toBeUndefined()
    })

    it('should silently skip when session file JSON has no sessionId field', () => {
      mocked_exec
        .mockReturnValueOnce(Buffer.from('100\n'))   // display-message
        .mockReturnValueOnce(Buffer.from('200\n'))   // pgrep
      mocked_read_file.mockReturnValueOnce(JSON.stringify({ other: 'data' }))

      expect(() => syncSessionId('cr-test')).not.toThrow()
      const set_env_call = mocked_exec.mock.calls.find(
        (call) => call[0] === 'tmux' && (call[1] as string[])[0] === 'set-environment',
      )
      expect(set_env_call).toBeUndefined()
    })

    it('should handle empty pgrep output gracefully', () => {
      mocked_exec
        .mockReturnValueOnce(Buffer.from('100\n'))  // display-message
        .mockReturnValueOnce(Buffer.from('\n'))      // pgrep empty output

      expect(() => syncSessionId('cr-test')).not.toThrow()
      expect(mocked_read_file).not.toHaveBeenCalled()
    })
  })

  describe('sessionFileExists', () => {
    it('should return true when the session JSONL file exists', () => {
      mocked_exists.mockReturnValue(true)

      const result = sessionFileExists('/home/user/projects/AGENTS', 'abc12345-1234-5678-9abc-def012345678')

      expect(result).toBe(true)
      expect(mocked_exists).toHaveBeenCalledWith(
        '/home/user/.claude/projects/-home-user-projects-AGENTS/abc12345-1234-5678-9abc-def012345678.jsonl',
      )
    })

    it('should return false when the session JSONL file does not exist', () => {
      mocked_exists.mockReturnValue(false)

      const result = sessionFileExists('/home/user/projects/AGENTS', 'abc12345-1234-5678-9abc-def012345678')

      expect(result).toBe(false)
    })

    it('should encode path by replacing all / with -', () => {
      mocked_exists.mockReturnValue(true)

      sessionFileExists('/home/applepig/Dropbox/projects/AGENTS', 'deadbeef-1234-5678-9abc-def012345678')

      expect(mocked_exists).toHaveBeenCalledWith(
        '/home/user/.claude/projects/-home-applepig-Dropbox-projects-AGENTS/deadbeef-1234-5678-9abc-def012345678.jsonl',
      )
    })

    it('should handle root directory path encoding', () => {
      mocked_exists.mockReturnValue(false)

      sessionFileExists('/', 'abc12345-1234-5678-9abc-def012345678')

      expect(mocked_exists).toHaveBeenCalledWith(
        '/home/user/.claude/projects/-/abc12345-1234-5678-9abc-def012345678.jsonl',
      )
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
