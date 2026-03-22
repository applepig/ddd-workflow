import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state.ts', () => ({
  loadState: vi.fn(),
}))

vi.mock('../tmux.ts', () => ({
  listSessions: vi.fn(),
}))

describe('ls command', () => {
  let console_log_spy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.resetModules()

    vi.mock('../state.ts', () => ({
      loadState: vi.fn(),
    }))
    vi.mock('../tmux.ts', () => ({
      listSessions: vi.fn(),
    }))

    console_log_spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('should output "No claude sessions." when state is empty', async () => {
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({})

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue([])

    const { ls } = await import('./ls.ts')
    await ls([])

    expect(console_log_spy).toHaveBeenCalled()
    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('No claude sessions.')
  })

  it('should show formatted table with NAME, DIR, RESTART, STATUS columns', async () => {
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({
      'my-project': {
        dir: '/home/user/projects/my-project',
        restart: 'always',
        created_at: '2026-03-22T10:00:00Z',
      },
    })

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue(['my-project'])

    const { ls } = await import('./ls.ts')
    await ls([])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('NAME')
    expect(output).toContain('DIR')
    expect(output).toContain('RESTART')
    expect(output).toContain('STATUS')
    expect(output).toContain('my-project')
    expect(output).toContain('running')
  })

  it('should show status "running" when tmux session exists', async () => {
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({
      'my-project': {
        dir: '/home/user/projects/my-project',
        restart: 'always',
        created_at: '2026-03-22T10:00:00Z',
      },
    })

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue(['my-project'])

    const { ls } = await import('./ls.ts')
    await ls([])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('running')
  })

  it('should show status "dead (restarting...)" when tmux session missing and restart is always', async () => {
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({
      'api-server': {
        dir: '/home/user/projects/api-server',
        restart: 'always',
        created_at: '2026-03-22T10:00:00Z',
      },
    })

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue([])

    const { ls } = await import('./ls.ts')
    await ls([])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('dead (restarting...)')
  })

  it('should show status "dead (restarting...)" when tmux session missing and restart is on-failure', async () => {
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({
      'api-server': {
        dir: '/home/user/projects/api-server',
        restart: 'on-failure',
        created_at: '2026-03-22T10:00:00Z',
      },
    })

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue([])

    const { ls } = await import('./ls.ts')
    await ls([])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('dead (restarting...)')
  })

  it('should show status "dead" when tmux session missing and restart is no', async () => {
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({
      scratch: {
        dir: '/tmp/scratch',
        restart: 'no',
        created_at: '2026-03-22T10:00:00Z',
      },
    })

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue([])

    const { ls } = await import('./ls.ts')
    await ls([])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('dead')
    expect(output).not.toContain('restarting')
  })

  it('should replace home directory prefix with ~ in dir display', async () => {
    const home = process.env.HOME || '/home/user'
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({
      'my-project': {
        dir: `${home}/projects/my-project`,
        restart: 'always',
        created_at: '2026-03-22T10:00:00Z',
      },
    })

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue(['my-project'])

    const { ls } = await import('./ls.ts')
    await ls([])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('~/projects/my-project')
    // Should NOT contain the full home path in the output
    expect(output).not.toContain(`${home}/projects/my-project`)
  })

  it('should output only names with --quiet flag', async () => {
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({
      'my-project': {
        dir: '/home/user/projects/my-project',
        restart: 'always',
        created_at: '2026-03-22T10:00:00Z',
      },
      'api-server': {
        dir: '/home/user/projects/api-server',
        restart: 'no',
        created_at: '2026-03-22T11:00:00Z',
      },
    })

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue(['my-project'])

    const { ls } = await import('./ls.ts')
    await ls(['-q'])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('my-project')
    expect(output).toContain('api-server')
    // In quiet mode, should NOT contain table headers
    expect(output).not.toContain('NAME')
    expect(output).not.toContain('DIR')
    expect(output).not.toContain('STATUS')
  })

  it('should output only names with --quiet long flag', async () => {
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({
      test: {
        dir: '/tmp/test',
        restart: 'always',
        created_at: '2026-03-22T10:00:00Z',
      },
    })

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue([])

    const { ls } = await import('./ls.ts')
    await ls(['--quiet'])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('test')
    expect(output).not.toContain('NAME')
  })

  it('should show multiple sessions with correct statuses', async () => {
    const home = process.env.HOME || '/home/user'
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({
      'my-project': {
        dir: `${home}/projects/my-project`,
        restart: 'always',
        created_at: '2026-03-22T10:00:00Z',
      },
      'api-server': {
        dir: `${home}/projects/api-server`,
        restart: 'always',
        created_at: '2026-03-22T11:00:00Z',
      },
      scratch: {
        dir: '/tmp/scratch',
        restart: 'no',
        created_at: '2026-03-22T12:00:00Z',
      },
    })

    const tmux_mod = await import('../tmux.ts')
    // Only my-project is running
    vi.mocked(tmux_mod.listSessions).mockReturnValue(['my-project'])

    const { ls } = await import('./ls.ts')
    await ls([])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('my-project')
    expect(output).toContain('api-server')
    expect(output).toContain('scratch')
  })

  it('should handle "No claude sessions." message for quiet mode too', async () => {
    const state_mod = await import('../state.ts')
    vi.mocked(state_mod.loadState).mockReturnValue({})

    const tmux_mod = await import('../tmux.ts')
    vi.mocked(tmux_mod.listSessions).mockReturnValue([])

    const { ls } = await import('./ls.ts')
    await ls(['-q'])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('No claude sessions.')
  })
})
