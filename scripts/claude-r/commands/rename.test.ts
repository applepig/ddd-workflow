import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state.ts', () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}))

vi.mock('../tmux.ts', () => ({
  killSession: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock('../fuzzy-match.ts', () => ({
  fuzzyMatch: vi.fn(),
}))

import { loadState, saveState } from '../state.ts'
import { killSession, createSession } from '../tmux.ts'
import { fuzzyMatch } from '../fuzzy-match.ts'
import { rename } from './rename.ts'

const mock_loadState = vi.mocked(loadState)
const mock_saveState = vi.mocked(saveState)
const mock_killSession = vi.mocked(killSession)
const mock_createSession = vi.mocked(createSession)
const mock_fuzzyMatch = vi.mocked(fuzzyMatch)

describe('rename', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('should rename a session and update state', async () => {
    const config = { dir: '/tmp/proj', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' }
    const state = { 'old-name': config }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['old-name'] })

    await rename(['old-name', 'new-name'])

    expect(mock_saveState).toHaveBeenCalledWith({ 'new-name': config })
    expect(mock_killSession).toHaveBeenCalledWith('old-name')
    expect(mock_createSession).toHaveBeenCalledWith('new-name', '/tmp/proj', 'new-name')
  })

  it('should preserve original config (dir, restart, created_at)', async () => {
    const config = { dir: '/home/user/project', restart: 'always' as const, created_at: '2024-06-15T12:00:00Z' }
    const state = { 'alpha': config, 'beta': { dir: '/b', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' } }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['alpha'] })

    await rename(['alpha', 'alpha-v2'])

    const saved_state = mock_saveState.mock.calls[0][0]
    expect(saved_state['alpha-v2']).toEqual(config)
    expect(saved_state['alpha']).toBeUndefined()
    expect(saved_state['beta']).toBeDefined()
  })

  it('should resolve old name via fuzzy match', async () => {
    const config = { dir: '/tmp', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' }
    const state = { 'my-project': config }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'unique', matches: ['my-project'] })

    await rename(['my', 'new-name'])

    expect(mock_fuzzyMatch).toHaveBeenCalledWith('my', ['my-project'])
    expect(mock_killSession).toHaveBeenCalledWith('my-project')
    expect(mock_createSession).toHaveBeenCalledWith('new-name', '/tmp', 'new-name')
  })

  it('should throw error when new name already exists in state', async () => {
    const state = {
      'old-name': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      'taken': { dir: '/b', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['old-name'] })

    await expect(rename(['old-name', 'taken'])).rejects.toThrow('already exists')
  })

  it('should throw error when new name contains invalid characters (spaces)', async () => {
    const state = {
      'old-name': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['old-name'] })

    await expect(rename(['old-name', 'bad name'])).rejects.toThrow()
  })

  it('should throw error when new name contains special characters', async () => {
    const state = {
      'old-name': { dir: '/a', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
    }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['old-name'] })

    await expect(rename(['old-name', 'bad@name!'])).rejects.toThrow()
  })

  it('should accept valid names with alphanumeric, underscore, and hyphen', async () => {
    const config = { dir: '/tmp', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' }
    const state = { 'old': config }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['old'] })

    await rename(['old', 'my_new-Name123'])

    expect(mock_saveState).toHaveBeenCalled()
  })

  it('should throw error when old name not found', async () => {
    mock_loadState.mockReturnValue({})
    mock_fuzzyMatch.mockReturnValue({ type: 'none', matches: [] })

    await expect(rename(['xyz', 'new'])).rejects.toThrow('not found')
  })

  it('should throw error when insufficient arguments (no new name)', async () => {
    await expect(rename(['old-name'])).rejects.toThrow()
  })

  it('should throw error when no arguments at all', async () => {
    await expect(rename([])).rejects.toThrow()
  })

  it('should output a success message', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const config = { dir: '/tmp', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' }
    const state = { 'old': config }
    mock_loadState.mockReturnValue(state)
    mock_fuzzyMatch.mockReturnValue({ type: 'exact', matches: ['old'] })

    await rename(['old', 'new-name'])

    expect(spy).toHaveBeenCalled()
  })
})
