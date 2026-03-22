import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  }
})

vi.mock('../state.ts', () => ({
  loadState: vi.fn(() => ({})),
  saveState: vi.fn(),
}))

vi.mock('../tmux.ts', () => ({
  createSession: vi.fn(),
}))

import { loadState, saveState } from '../state.ts'
import { createSession } from '../tmux.ts'

const mock_existsSync = vi.mocked(fs.existsSync)
const mock_loadState = vi.mocked(loadState)
const mock_saveState = vi.mocked(saveState)
const mock_createSession = vi.mocked(createSession)

describe('add command', () => {
  let console_log_spy: ReturnType<typeof vi.spyOn>
  let date_now_spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mock_existsSync.mockReturnValue(true)
    mock_loadState.mockReturnValue({})
    console_log_spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    date_now_spy = vi.spyOn(Date, 'now').mockReturnValue(1000000)
  })

  afterEach(() => {
    date_now_spy.mockRestore()
  })

  it('should add session using cwd and basename-timestamp when no flags given', async () => {
    const cwd_spy = vi.spyOn(process, 'cwd').mockReturnValue('/home/user/my-project')
    const expected_name = `my-project-${(1000000).toString(36)}`

    const { add } = await import('./add.ts')
    await add([])

    expect(mock_saveState).toHaveBeenCalledWith(
      expect.objectContaining({
        [expected_name]: expect.objectContaining({
          dir: '/home/user/my-project',
          restart: 'always',
        }),
      })
    )

    expect(mock_createSession).toHaveBeenCalledWith(
      expected_name,
      '/home/user/my-project',
      expected_name
    )

    cwd_spy.mockRestore()
  })

  it('should use --dir flag as working directory', async () => {
    const expected_name = `foo-${(1000000).toString(36)}`
    const { add } = await import('./add.ts')
    await add(['-d', '/home/user/projects/foo'])

    expect(mock_saveState).toHaveBeenCalledWith(
      expect.objectContaining({
        [expected_name]: expect.objectContaining({
          dir: '/home/user/projects/foo',
        }),
      })
    )
  })

  it('should use --name flag as session name', async () => {
    const { add } = await import('./add.ts')
    await add(['-d', '/home/user/projects/foo', '-n', 'myapi'])

    expect(mock_saveState).toHaveBeenCalledWith(
      expect.objectContaining({
        myapi: expect.objectContaining({
          dir: '/home/user/projects/foo',
        }),
      })
    )

    expect(mock_createSession).toHaveBeenCalledWith(
      'myapi',
      '/home/user/projects/foo',
      'myapi'
    )
  })

  it('should use --restart flag to set restart policy', async () => {
    const { add } = await import('./add.ts')
    await add(['-d', '/home/user/projects/foo', '-n', 'foo', '--restart', 'no'])

    expect(mock_saveState).toHaveBeenCalledWith(
      expect.objectContaining({
        foo: expect.objectContaining({
          restart: 'no',
        }),
      })
    )
  })

  it('should throw error when session name already exists (explicit --name)', async () => {
    mock_loadState.mockReturnValue({
      myapi: {
        dir: '/home/user/projects/foo',
        restart: 'always',
        created_at: '2026-03-22T10:00:00Z',
      },
    })

    const { add } = await import('./add.ts')

    await expect(add(['-d', '/home/user/projects/foo', '-n', 'myapi'])).rejects.toThrow(
      /already exists/i
    )
  })

  it('should include helpful message about --name when name conflicts', async () => {
    mock_loadState.mockReturnValue({
      myapi: {
        dir: '/home/user/projects/foo',
        restart: 'always',
        created_at: '2026-03-22T10:00:00Z',
      },
    })

    const { add } = await import('./add.ts')

    await expect(add(['-d', '/home/user/projects/foo', '-n', 'myapi'])).rejects.toThrow(
      /--name/
    )
  })

  it('should throw error when name contains invalid characters (spaces)', async () => {
    const { add } = await import('./add.ts')

    await expect(add(['-n', 'my project'])).rejects.toThrow(/invalid/i)
  })

  it('should throw error when name contains special characters', async () => {
    const { add } = await import('./add.ts')

    await expect(add(['-n', 'foo@bar'])).rejects.toThrow(/invalid/i)
  })

  it('should throw error when --dir points to non-existent directory', async () => {
    mock_existsSync.mockReturnValue(false)

    const { add } = await import('./add.ts')

    await expect(add(['-d', '/nonexistent/path'])).rejects.toThrow(
      /does not exist/i
    )
  })

  it('should store created_at as ISO 8601 timestamp', async () => {
    const { add } = await import('./add.ts')
    await add(['-d', '/home/user/projects/foo', '-n', 'foo'])

    const saved_state = mock_saveState.mock.calls[0][0]
    const created_at = saved_state['foo'].created_at

    // ISO 8601 format check
    expect(new Date(created_at).toISOString()).toBe(created_at)
  })

  it('should preserve existing sessions when adding a new one', async () => {
    const existing_state = {
      existing: {
        dir: '/home/user/existing',
        restart: 'always' as const,
        created_at: '2026-03-22T10:00:00Z',
      },
    }
    mock_loadState.mockReturnValue(existing_state)

    const { add } = await import('./add.ts')
    await add(['-d', '/home/user/projects/foo', '-n', 'foo'])

    const saved_state = mock_saveState.mock.calls[0][0]
    expect(saved_state['existing']).toEqual(existing_state['existing'])
    expect(saved_state['foo']).toBeDefined()
  })

  it('should resolve relative --dir path to absolute', async () => {
    const cwd_spy = vi.spyOn(process, 'cwd').mockReturnValue('/home/user')

    const { add } = await import('./add.ts')
    await add(['-d', './projects/foo', '-n', 'foo'])

    const saved_state = mock_saveState.mock.calls[0][0]
    expect(saved_state['foo'].dir).toBe('/home/user/projects/foo')

    cwd_spy.mockRestore()
  })

  it('should allow valid names with letters, numbers, hyphens, and underscores', async () => {
    const { add } = await import('./add.ts')

    // Should not throw
    await add(['-d', '/home/user/projects/foo', '-n', 'My_Project-123'])

    expect(mock_saveState).toHaveBeenCalled()
  })

  it('should throw error when restart policy is invalid', async () => {
    const { add } = await import('./add.ts')

    await expect(add(['-d', '/home/user/projects/foo', '-n', 'foo', '--restart', 'banana'])).rejects.toThrow(
      /invalid restart policy/i
    )
  })

  it('should include valid options in error message when restart policy is invalid', async () => {
    const { add } = await import('./add.ts')

    await expect(add(['-d', '/home/user/projects/foo', '-n', 'foo', '--restart', 'banana'])).rejects.toThrow(
      /always.*on-failure.*no/
    )
  })

  it('should default restart policy to always', async () => {
    const { add } = await import('./add.ts')
    await add(['-d', '/home/user/projects/foo', '-n', 'foo'])

    const saved_state = mock_saveState.mock.calls[0][0]
    expect(saved_state['foo'].restart).toBe('always')
  })

  it('should output success message after adding session', async () => {
    const { add } = await import('./add.ts')
    await add(['-d', '/home/user/projects/foo', '-n', 'foo'])

    expect(console_log_spy).toHaveBeenCalled()
    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('foo')
  })
})
