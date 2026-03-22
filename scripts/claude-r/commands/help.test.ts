import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('help', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should print usage information to stdout', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { help } = await import('./help.ts')
    help()

    expect(spy).toHaveBeenCalledTimes(1)
    const output = spy.mock.calls[0][0] as string
    expect(output).toContain('Usage: claude-r <command>')
  })

  it('should list all available commands', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { help } = await import('./help.ts')
    help()

    const output = spy.mock.calls[0][0] as string
    const expected_commands = ['add', 'rm', 'ls', 'restart', 'rename', 'resume', 'daemon', 'install', 'uninstall', 'help']
    for (const cmd of expected_commands) {
      expect(output).toContain(cmd)
    }
  })

  it('should mention -h and --help flags', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { help } = await import('./help.ts')
    help()

    const output = spy.mock.calls[0][0] as string
    expect(output).toContain('-h')
    expect(output).toContain('--help')
  })
})
