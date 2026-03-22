import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state.ts', () => ({
  loadState: vi.fn(),
}))

vi.mock('../tmux.ts', () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
}))

import { loadState } from '../state.ts'
import { createSession, listSessions } from '../tmux.ts'
import { reconcile } from './daemon.ts'

const mock_loadState = vi.mocked(loadState)
const mock_createSession = vi.mocked(createSession)
const mock_listSessions = vi.mocked(listSessions)

describe('reconcile', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should return all zeros when state is empty', async () => {
    mock_loadState.mockReturnValue({})
    mock_listSessions.mockReturnValue([])

    const result = await reconcile('/tmp/test-state.json')

    expect(result).toEqual({
      checked: 0,
      restarted: [],
      skipped: [],
    })
  })

  it('should report checked count matching state entries', async () => {
    mock_loadState.mockReturnValue({
      'proj-a': { dir: '/a', restart: 'always', created_at: '2025-01-01T00:00:00Z' },
      'proj-b': { dir: '/b', restart: 'always', created_at: '2025-01-01T00:00:00Z' },
    })
    mock_listSessions.mockReturnValue(['proj-a', 'proj-b'])

    const result = await reconcile('/tmp/test-state.json')

    expect(result.checked).toBe(2)
    expect(result.restarted).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('should restart missing session with restart: always', async () => {
    mock_loadState.mockReturnValue({
      'proj-a': { dir: '/a', restart: 'always', created_at: '2025-01-01T00:00:00Z' },
      'proj-b': { dir: '/b', restart: 'always', created_at: '2025-01-01T00:00:00Z' },
    })
    mock_listSessions.mockReturnValue(['proj-a'])

    const result = await reconcile('/tmp/test-state.json')

    expect(result.checked).toBe(2)
    expect(result.restarted).toEqual(['proj-b'])
    expect(result.skipped).toEqual([])
  })

  it('should skip missing session with restart: no', async () => {
    mock_loadState.mockReturnValue({
      'my-session': { dir: '/home/user/proj', restart: 'no', created_at: '2025-01-01T00:00:00Z' },
    })
    mock_listSessions.mockReturnValue([])

    const result = await reconcile('/tmp/test-state.json')

    expect(result.checked).toBe(1)
    expect(result.restarted).toEqual([])
    expect(result.skipped).toEqual(['my-session'])
  })

  it('should restart missing session with restart: on-failure (v1 same as always)', async () => {
    mock_loadState.mockReturnValue({
      'fail-proj': { dir: '/fail', restart: 'on-failure', created_at: '2025-01-01T00:00:00Z' },
    })
    mock_listSessions.mockReturnValue([])

    const result = await reconcile('/tmp/test-state.json')

    expect(result.checked).toBe(1)
    expect(result.restarted).toEqual(['fail-proj'])
    expect(result.skipped).toEqual([])
  })

  it('should handle mixed restart policies with all sessions missing', async () => {
    mock_loadState.mockReturnValue({
      'always-proj': { dir: '/a', restart: 'always', created_at: '2025-01-01T00:00:00Z' },
      'failure-proj': { dir: '/b', restart: 'on-failure', created_at: '2025-01-01T00:00:00Z' },
      'no-proj': { dir: '/c', restart: 'no', created_at: '2025-01-01T00:00:00Z' },
    })
    mock_listSessions.mockReturnValue([])

    const result = await reconcile('/tmp/test-state.json')

    expect(result.checked).toBe(3)
    expect(result.restarted).toContain('always-proj')
    expect(result.restarted).toContain('failure-proj')
    expect(result.restarted).toHaveLength(2)
    expect(result.skipped).toEqual(['no-proj'])
  })

  it('should call createSession with correct name, dir, and claude_name', async () => {
    mock_loadState.mockReturnValue({
      'my-proj': { dir: '/home/user/my-proj', restart: 'always', created_at: '2025-01-01T00:00:00Z' },
    })
    mock_listSessions.mockReturnValue([])

    await reconcile('/tmp/test-state.json')

    expect(mock_createSession).toHaveBeenCalledWith('my-proj', '/home/user/my-proj', 'my-proj')
  })

  it('should not call createSession for sessions that exist in tmux', async () => {
    mock_loadState.mockReturnValue({
      'running': { dir: '/run', restart: 'always', created_at: '2025-01-01T00:00:00Z' },
    })
    mock_listSessions.mockReturnValue(['running'])

    await reconcile('/tmp/test-state.json')

    expect(mock_createSession).not.toHaveBeenCalled()
  })

  it('should not call createSession for sessions with restart: no', async () => {
    mock_loadState.mockReturnValue({
      'no-restart': { dir: '/nr', restart: 'no', created_at: '2025-01-01T00:00:00Z' },
    })
    mock_listSessions.mockReturnValue([])

    await reconcile('/tmp/test-state.json')

    expect(mock_createSession).not.toHaveBeenCalled()
  })

  it('should pass config_path to loadState', async () => {
    mock_loadState.mockReturnValue({})
    mock_listSessions.mockReturnValue([])

    await reconcile('/custom/path/state.json')

    expect(mock_loadState).toHaveBeenCalledWith('/custom/path/state.json')
  })
})
