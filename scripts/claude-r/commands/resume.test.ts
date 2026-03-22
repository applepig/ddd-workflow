import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state.ts', () => ({
  loadState: vi.fn(),
}))

vi.mock('../tmux.ts', () => ({
  sessionExists: vi.fn(),
  attachSession: vi.fn(),
}))

vi.mock('../fuzzy-match.ts', () => ({
  fuzzyMatch: vi.fn(),
}))

import { loadState } from '../state.ts'
import { sessionExists, attachSession } from '../tmux.ts'
import { fuzzyMatch } from '../fuzzy-match.ts'
import { resume } from './resume.ts'

const mock_loadState = vi.mocked(loadState)
const mock_sessionExists = vi.mocked(sessionExists)
const mock_attachSession = vi.mocked(attachSession)
const mock_fuzzyMatch = vi.mocked(fuzzyMatch)

describe('resume', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('should attach to a running session by exact name', async () => {
    const state = {
      'my-project': { dir: '/tmp/proj', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['my-project'] })
    mock_sessionExists.mockReturnValue(true)

    await resume(['my-project'])

    expect(mock_attachSession).toHaveBeenCalledWith('my-project')
  })

  it('should attach to a running session by fuzzy match', async () => {
    const state = {
      'my-project': { dir: '/tmp/proj', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'unique', matches: ['my-project'] })
    mock_sessionExists.mockReturnValue(true)

    await resume(['my'])

    expect(mock_fuzzyMatch).toHaveBeenCalledWith('my', ['my-project'])
    expect(mock_attachSession).toHaveBeenCalledWith('my-project')
  })

  it('should throw error when session is not running and suggest restart', async () => {
    const state = {
      'my-project': { dir: '/tmp/proj', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['my-project'] })
    mock_sessionExists.mockReturnValue(false)

    await expect(resume(['my-project'])).rejects.toThrow('not running')
    await expect(resume(['my-project'])).rejects.toThrow('restart')
  })

  it('should throw error when no name provided', async () => {
    await expect(resume([])).rejects.toThrow()
  })

  it('should throw error when fuzzy match is ambiguous', async () => {
    const state = {
      'api-server': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      'api-client': { dir: '/b', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'ambiguous', matches: ['api-server', 'api-client'] })

    await expect(resume(['api'])).rejects.toThrow('Ambiguous')
  })

  it('should throw error when session not found', async () => {
    mock_loadState.mockReturnValue({})
    mock_fuzzyMatch.mockReturnValue({ type: 'none', matches: [] })

    await expect(resume(['xyz'])).rejects.toThrow('not found')
  })
})
