import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing
vi.mock('../state.ts', () => ({
  loadState: vi.fn(),
}))

vi.mock('../tmux.ts', () => ({
  listSessions: vi.fn(),
}))

vi.mock('./add.ts', () => ({
  add: vi.fn(),
}))

vi.mock('./rm.ts', () => ({
  rm: vi.fn(),
}))

vi.mock('./resume.ts', () => ({
  resume: vi.fn(),
}))

vi.mock('./restart.ts', () => ({
  restart: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(),
}))

import { loadState } from '../state.ts'
import { listSessions } from '../tmux.ts'
import { add } from './add.ts'
import { rm } from './rm.ts'
import { resume } from './resume.ts'
import { restart } from './restart.ts'
import * as p from '@clack/prompts'
import { interactive } from './interactive.ts'

const mock_loadState = vi.mocked(loadState)
const mock_listSessions = vi.mocked(listSessions)
const mock_add = vi.mocked(add)
const mock_rm = vi.mocked(rm)
const mock_resume = vi.mocked(resume)
const mock_restart = vi.mocked(restart)
const mock_select = vi.mocked(p.select)
const mock_confirm = vi.mocked(p.confirm)
const mock_text = vi.mocked(p.text)
const mock_isCancel = vi.mocked(p.isCancel)

describe('interactive', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Default: isCancel returns false
    mock_isCancel.mockReturnValue(false)
  })

  describe('no sessions exist', () => {
    beforeEach(() => {
      mock_loadState.mockReturnValue({})
      mock_listSessions.mockReturnValue([])
    })

    it('should ask to add a new session when no sessions exist', async () => {
      mock_confirm.mockResolvedValue(false)

      await interactive()

      expect(mock_confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Add a new session'),
        })
      )
    })

    it('should call add when user confirms adding a session', async () => {
      mock_confirm.mockResolvedValue(true)
      mock_add.mockResolvedValue()

      await interactive()

      expect(mock_add).toHaveBeenCalledWith([])
    })

    it('should not call any command when user declines adding a session', async () => {
      mock_confirm.mockResolvedValue(false)

      await interactive()

      expect(mock_add).not.toHaveBeenCalled()
      expect(mock_rm).not.toHaveBeenCalled()
    })

    it('should exit when user cancels confirm with Ctrl+C', async () => {
      mock_confirm.mockResolvedValue(Symbol('cancel'))
      mock_isCancel.mockReturnValue(true)
      const mock_exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

      await expect(interactive()).rejects.toThrow('process.exit')

      expect(mock_exit).toHaveBeenCalledWith(0)
    })
  })

  describe('sessions exist - main menu', () => {
    const sample_state = {
      'my-project': { dir: '/home/user/projects/my-project', restart: 'always' as const, created_at: '2025-01-01T00:00:00Z' },
      'api-server': { dir: '/home/user/projects/api', restart: 'no' as const, created_at: '2025-01-02T00:00:00Z' },
    }

    beforeEach(() => {
      mock_loadState.mockReturnValue({ ...sample_state })
      mock_listSessions.mockReturnValue(['my-project'])
    })

    it('should show select menu with session list', async () => {
      mock_select.mockResolvedValueOnce('__back__')

      await interactive()

      expect(mock_select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.any(String),
          options: expect.arrayContaining([
            expect.objectContaining({ value: 'my-project' }),
            expect.objectContaining({ value: 'api-server' }),
            expect.objectContaining({ value: '__add__' }),
            expect.objectContaining({ value: '__remove_all__' }),
          ]),
        })
      )
    })

    it('should show running status for active sessions', async () => {
      mock_select.mockResolvedValueOnce('__back__')

      await interactive()

      const call_args = mock_select.mock.calls[0][0] as { options: Array<{ value: string; label: string }> }
      const my_project_option = call_args.options.find((o: { value: string }) => o.value === 'my-project')

      expect(my_project_option?.label).toContain('running')
    })

    it('should show dead status for inactive sessions', async () => {
      mock_select.mockResolvedValueOnce('__back__')

      await interactive()

      const call_args = mock_select.mock.calls[0][0] as { options: Array<{ value: string; label: string }> }
      const api_option = call_args.options.find((o: { value: string }) => o.value === 'api-server')

      expect(api_option?.label).toContain('dead')
    })

    it('should call add when user selects "Add new session"', async () => {
      mock_select.mockResolvedValueOnce('__add__')
      mock_add.mockResolvedValue()

      await interactive()

      expect(mock_add).toHaveBeenCalledWith([])
    })

    it('should call rm with --all --force when user selects "Remove all"', async () => {
      mock_select.mockResolvedValueOnce('__remove_all__')
      mock_rm.mockResolvedValue()

      await interactive()

      expect(mock_rm).toHaveBeenCalledWith(['--all', '--force'])
    })

    it('should exit when user cancels select with Ctrl+C', async () => {
      mock_select.mockResolvedValueOnce(Symbol('cancel'))
      mock_isCancel.mockReturnValue(true)
      const mock_exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

      await expect(interactive()).rejects.toThrow('process.exit')

      expect(mock_exit).toHaveBeenCalledWith(0)
    })
  })

  describe('action submenu', () => {
    const sample_state = {
      'my-project': { dir: '/home/user/projects/my-project', restart: 'always' as const, created_at: '2025-01-01T00:00:00Z' },
    }

    beforeEach(() => {
      mock_loadState.mockReturnValue({ ...sample_state })
    })

    it('should call resume when user selects Resume for a running session', async () => {
      mock_listSessions.mockReturnValue(['my-project'])
      // First select: choose session; second select: choose action
      mock_select
        .mockResolvedValueOnce('my-project')
        .mockResolvedValueOnce('resume')
      mock_resume.mockResolvedValue()

      await interactive()

      expect(mock_resume).toHaveBeenCalledWith(['my-project'])
    })

    it('should call restart when user selects Restart', async () => {
      mock_listSessions.mockReturnValue(['my-project'])
      mock_select
        .mockResolvedValueOnce('my-project')
        .mockResolvedValueOnce('restart')
      mock_restart.mockResolvedValue()

      await interactive()

      expect(mock_restart).toHaveBeenCalledWith(['my-project'])
    })

    it('should call rm when user selects Remove', async () => {
      mock_listSessions.mockReturnValue(['my-project'])
      mock_select
        .mockResolvedValueOnce('my-project')
        .mockResolvedValueOnce('remove')
      mock_rm.mockResolvedValue()

      await interactive()

      expect(mock_rm).toHaveBeenCalledWith(['my-project'])
    })

    it('should go back to main menu when user selects Back', async () => {
      mock_listSessions.mockReturnValue(['my-project'])
      // First loop: select session → back; second loop: select __back__ to exit
      mock_select
        .mockResolvedValueOnce('my-project')
        .mockResolvedValueOnce('back')
        .mockResolvedValueOnce('__back__')

      await interactive()

      // select should have been called 3 times: main menu, action submenu, main menu again
      expect(mock_select).toHaveBeenCalledTimes(3)
    })

    it('should disable Resume option when session is not running', async () => {
      mock_listSessions.mockReturnValue([]) // no running sessions
      mock_select
        .mockResolvedValueOnce('my-project')
        .mockResolvedValueOnce('restart')
      mock_restart.mockResolvedValue()

      await interactive()

      // Check the action submenu call (second call to select)
      const action_call = mock_select.mock.calls[1][0] as { options: Array<{ value: string; hint?: string }> }
      const resume_option = action_call.options.find((o: { value: string }) => o.value === 'resume')

      expect(resume_option?.hint).toContain('not running')
    })
  })

  describe('edge cases', () => {
    it('should exit cleanly when user cancels action submenu with Ctrl+C', async () => {
      mock_loadState.mockReturnValue({
        'my-project': { dir: '/tmp/p', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      })
      mock_listSessions.mockReturnValue(['my-project'])
      mock_select
        .mockResolvedValueOnce('my-project')
        .mockResolvedValueOnce(Symbol('cancel'))
      mock_isCancel.mockImplementation((value) => typeof value === 'symbol')
      const mock_exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

      await expect(interactive()).rejects.toThrow('process.exit')

      expect(mock_exit).toHaveBeenCalledWith(0)
    })

    it('should include a quit option in the main menu', async () => {
      mock_loadState.mockReturnValue({
        'my-project': { dir: '/tmp/p', restart: 'no' as const, created_at: '2025-01-01T00:00:00Z' },
      })
      mock_listSessions.mockReturnValue([])
      mock_select.mockResolvedValueOnce('__back__')

      await interactive()

      const call_args = mock_select.mock.calls[0][0] as { options: Array<{ value: string }> }
      const quit_option = call_args.options.find((o: { value: string }) => o.value === '__back__')

      expect(quit_option).toBeDefined()
    })
  })
})
