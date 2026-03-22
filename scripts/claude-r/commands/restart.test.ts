import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state.ts', () => ({
  loadState: vi.fn(),
}))

vi.mock('../tmux.ts', () => ({
  killSession: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock('../fuzzy-match.ts', () => ({
  fuzzyMatch: vi.fn(),
}))

import { loadState } from '../state.ts'
import { killSession, createSession } from '../tmux.ts'
import { fuzzyMatch } from '../fuzzy-match.ts'
import { restart } from './restart.ts'

const mock_loadState = vi.mocked(loadState)
const mock_killSession = vi.mocked(killSession)
const mock_createSession = vi.mocked(createSession)
const mock_fuzzyMatch = vi.mocked(fuzzyMatch)

describe('restart', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('should kill and recreate a session by exact name', async () => {
    const state = {
      'my-project': { dir: '/tmp/proj', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['my-project'] })

    await restart(['my-project'])

    expect(mock_killSession).toHaveBeenCalledWith('my-project')
    expect(mock_createSession).toHaveBeenCalledWith('my-project', '/tmp/proj', 'my-project')
  })

  it('should kill and recreate a session by fuzzy match', async () => {
    const state = {
      'my-project': { dir: '/home/user/proj', restart: 'always' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'unique', matches: ['my-project'] })

    await restart(['my'])

    expect(mock_fuzzyMatch).toHaveBeenCalledWith('my', ['my-project'])
    expect(mock_killSession).toHaveBeenCalledWith('my-project')
    expect(mock_createSession).toHaveBeenCalledWith('my-project', '/home/user/proj', 'my-project')
  })

  it('should call killSession before createSession', async () => {
    const call_order: string[] = []
    const state = {
      'proj': { dir: '/tmp', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['proj'] })
    mock_killSession.mockImplementation(() => { call_order.push('kill') })
    mock_createSession.mockImplementation(() => { call_order.push('create') })

    await restart(['proj'])

    expect(call_order).toEqual(['kill', 'create'])
  })

  it('should output a success message', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = {
      'proj': { dir: '/tmp', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['proj'] })

    await restart(['proj'])

    expect(spy).toHaveBeenCalled()
  })

  it('should throw error when no name provided', async () => {
    await expect(restart([])).rejects.toThrow()
  })

  it('should throw error when fuzzy match is ambiguous', async () => {
    const state = {
      'api-server': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      'api-client': { dir: '/b', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'ambiguous', matches: ['api-server', 'api-client'] })

    await expect(restart(['api'])).rejects.toThrow('Ambiguous')
  })

  it('should throw error when session not found in state', async () => {
    mock_loadState.mockReturnValue({})
    mock_fuzzyMatch.mockReturnValue({ type: 'none', matches: [] })

    await expect(restart(['xyz'])).rejects.toThrow('not found')
  })
})
