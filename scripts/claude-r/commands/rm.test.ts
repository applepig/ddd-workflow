import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state.ts', () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}))

vi.mock('../tmux.ts', () => ({
  killSession: vi.fn(),
}))

vi.mock('../fuzzy-match.ts', () => ({
  fuzzyMatch: vi.fn(),
}))

const mock_rl = {
  question: vi.fn(),
  close: vi.fn(),
}

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => mock_rl),
}))

import { loadState, saveState } from '../state.ts'
import { killSession } from '../tmux.ts'
import { fuzzyMatch } from '../fuzzy-match.ts'
import { rm } from './rm.ts'

const mock_loadState = vi.mocked(loadState)
const mock_saveState = vi.mocked(saveState)
const mock_killSession = vi.mocked(killSession)
const mock_fuzzyMatch = vi.mocked(fuzzyMatch)

describe('rm', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Re-configure mock_rl defaults
    mock_rl.question.mockReset()
    mock_rl.close.mockReset()
  })

  describe('single session removal', () => {
    it('should remove a session by exact name', async () => {
      const state = {
        'my-project': { dir: '/tmp/proj', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
        'other': { dir: '/tmp/other', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      }
      mock_loadState.mockReturnValue(state)
      mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['my-project'] })

      await rm(['my-project'])

      expect(mock_saveState).toHaveBeenCalledWith({ 'other': state['other'] })
      expect(mock_killSession).toHaveBeenCalledWith('my-project')
    })

    it('should remove a session by fuzzy match (unique)', async () => {
      const state = {
        'my-project': { dir: '/tmp/proj', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      }
      mock_loadState.mockReturnValue(state)
      mock_fuzzyMatch.mockReturnValue({ type: 'unique', matches: ['my-project'] })

      await rm(['my'])

      expect(mock_fuzzyMatch).toHaveBeenCalledWith('my', ['my-project'])
      expect(mock_killSession).toHaveBeenCalledWith('my-project')
    })
  })

  describe('--all flag', () => {
    it('should remove all sessions when user confirms with y', async () => {
      const state = {
        'proj-a': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
        'proj-b': { dir: '/b', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      }
      mock_loadState.mockReturnValue(state)
      mock_rl.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('y'))

      await rm(['--all'])

      expect(mock_saveState).toHaveBeenCalledWith({})
      expect(mock_killSession).toHaveBeenCalledWith('proj-a')
      expect(mock_killSession).toHaveBeenCalledWith('proj-b')
    })

    it('should not remove sessions when user declines with n', async () => {
      const state = {
        'proj-a': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      }
      mock_loadState.mockReturnValue(state)
      mock_rl.question.mockImplementation((_q: string, cb: (answer: string) => void) => cb('n'))

      await rm(['--all'])

      expect(mock_saveState).not.toHaveBeenCalled()
      expect(mock_killSession).not.toHaveBeenCalled()
    })

    it('should remove all sessions without prompt when --force is used', async () => {
      const state = {
        'proj-a': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
        'proj-b': { dir: '/b', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      }
      mock_loadState.mockReturnValue(state)

      await rm(['--all', '--force'])

      expect(mock_saveState).toHaveBeenCalledWith({})
      expect(mock_killSession).toHaveBeenCalledWith('proj-a')
      expect(mock_killSession).toHaveBeenCalledWith('proj-b')
    })

    it('should clear state before killing sessions (saveState called before killSession)', async () => {
      const call_order: string[] = []
      const state = {
        'proj-a': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
        'proj-b': { dir: '/b', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      }
      mock_loadState.mockReturnValue(state)
      mock_saveState.mockImplementation(() => { call_order.push('saveState') })
      mock_killSession.mockImplementation(() => { call_order.push('killSession') })

      await rm(['-a', '-f'])

      expect(call_order[0]).toBe('saveState')
      expect(call_order.filter(c => c === 'killSession')).toHaveLength(2)
    })

    it('should return early with message when no sessions exist', async () => {
      mock_loadState.mockReturnValue({})
      const console_spy = vi.spyOn(console, 'log')

      await rm(['-a', '-f'])

      expect(console_spy).toHaveBeenCalledWith('No sessions to remove.')
      expect(mock_saveState).not.toHaveBeenCalled()
      expect(mock_killSession).not.toHaveBeenCalled()
    })

    it('should accept short flags -a and -f', async () => {
      const state = {
        'proj-a': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      }
      mock_loadState.mockReturnValue(state)

      await rm(['-a', '-f'])

      expect(mock_saveState).toHaveBeenCalledWith({})
      expect(mock_killSession).toHaveBeenCalledWith('proj-a')
    })
  })

  describe('error cases', () => {
    it('should throw error when no name and no --all flag', async () => {
      await expect(rm([])).rejects.toThrow()
    })

    it('should throw error when fuzzy match is ambiguous', async () => {
      const state = {
        'api-server': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
        'api-client': { dir: '/b', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      }
      mock_loadState.mockReturnValue(state)
      mock_fuzzyMatch.mockReturnValue({ type: 'ambiguous', matches: ['api-server', 'api-client'] })

      await expect(rm(['api'])).rejects.toThrow('Ambiguous')
      await expect(rm(['api'])).rejects.toThrow('api-server')
      await expect(rm(['api'])).rejects.toThrow('api-client')
    })

    it('should throw error when session not found', async () => {
      mock_loadState.mockReturnValue({})
      mock_fuzzyMatch.mockReturnValue({ type: 'none', matches: [] })

      await expect(rm(['xyz'])).rejects.toThrow('not found')
    })
  })
})
