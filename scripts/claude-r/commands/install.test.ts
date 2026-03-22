import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as child_process from 'node:child_process'
import os from 'node:os'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    execSync: vi.fn(() => ''),
  }
})

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    default: {
      ...actual,
      homedir: vi.fn(() => '/home/testuser'),
      userInfo: vi.fn(() => ({ username: 'testuser' })),
    },
    homedir: vi.fn(() => '/home/testuser'),
    userInfo: vi.fn(() => ({ username: 'testuser' })),
  }
})

const mock_mkdirSync = vi.mocked(fs.mkdirSync)
const mock_writeFileSync = vi.mocked(fs.writeFileSync)
const mock_execSync = vi.mocked(child_process.execSync)
const mock_homedir = vi.mocked(os.homedir)
const mock_userInfo = vi.mocked(os.userInfo)

describe('install command', () => {
  let console_log_spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mock_homedir.mockReturnValue('/home/testuser')
    mock_userInfo.mockReturnValue({ username: 'testuser' } as any)
    mock_execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd === 'which tsx') {
        return '/home/testuser/.local/bin/tsx'
      }
      return ''
    })
    console_log_spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('should create systemd user directory', async () => {
    const { install } = await import('./install.ts')
    await install([])

    expect(mock_mkdirSync).toHaveBeenCalledWith(
      '/home/testuser/.config/systemd/user',
      { recursive: true }
    )
  })

  it('should write service file to correct path', async () => {
    const { install } = await import('./install.ts')
    await install([])

    expect(mock_writeFileSync).toHaveBeenCalledWith(
      '/home/testuser/.config/systemd/user/claude-r.service',
      expect.any(String)
    )
  })

  it('should generate service file with correct Description', async () => {
    const { install } = await import('./install.ts')
    await install([])

    const service_content = mock_writeFileSync.mock.calls[0][1] as string
    expect(service_content).toContain('Description=Claude Remote Session Manager')
  })

  it('should generate service file with ExecStart using resolved tsx path', async () => {
    const { install } = await import('./install.ts')
    await install([])

    const service_content = mock_writeFileSync.mock.calls[0][1] as string
    expect(service_content).toContain('ExecStart=/home/testuser/.local/bin/tsx')
    expect(service_content).toContain('main.ts daemon')
  })

  it('should resolve tsx path via which command', async () => {
    const { install } = await import('./install.ts')
    await install([])

    expect(mock_execSync).toHaveBeenCalledWith('which tsx', { encoding: 'utf-8' })
  })

  it('should generate service file with HOME environment variable', async () => {
    const { install } = await import('./install.ts')
    await install([])

    const service_content = mock_writeFileSync.mock.calls[0][1] as string
    expect(service_content).toContain('Environment=HOME=/home/testuser')
  })

  it('should generate service file with Restart=always and RestartSec=5', async () => {
    const { install } = await import('./install.ts')
    await install([])

    const service_content = mock_writeFileSync.mock.calls[0][1] as string
    expect(service_content).toContain('Restart=always')
    expect(service_content).toContain('RestartSec=5')
  })

  it('should generate service file with WantedBy=default.target', async () => {
    const { install } = await import('./install.ts')
    await install([])

    const service_content = mock_writeFileSync.mock.calls[0][1] as string
    expect(service_content).toContain('WantedBy=default.target')
  })

  it('should call systemctl daemon-reload', async () => {
    const { install } = await import('./install.ts')
    await install([])

    expect(mock_execSync).toHaveBeenCalledWith('systemctl --user daemon-reload')
  })

  it('should call systemctl enable --now claude-r.service', async () => {
    const { install } = await import('./install.ts')
    await install([])

    expect(mock_execSync).toHaveBeenCalledWith(
      'systemctl --user enable --now claude-r.service'
    )
  })

  it('should check linger status via loginctl with os.userInfo username', async () => {
    const { install } = await import('./install.ts')
    await install([])

    expect(mock_execSync).toHaveBeenCalledWith(
      'loginctl show-user testuser -p Linger --value',
      expect.objectContaining({ encoding: 'utf-8' })
    )
  })

  it('should not show linger prompt when linger is already enabled', async () => {
    mock_execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd === 'which tsx') {
        return '/home/testuser/.local/bin/tsx'
      }
      if (typeof cmd === 'string' && cmd.includes('loginctl')) {
        return 'yes'
      }
      return ''
    })

    const { install } = await import('./install.ts')
    await install([])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).not.toContain('loginctl enable-linger')
  })

  it('should show linger prompt when linger is not enabled', async () => {
    mock_execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd === 'which tsx') {
        return '/home/testuser/.local/bin/tsx'
      }
      if (typeof cmd === 'string' && cmd.includes('loginctl')) {
        return 'no'
      }
      return ''
    })

    const { install } = await import('./install.ts')
    await install([])

    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('loginctl enable-linger')
  })

  it('should output success message', async () => {
    const { install } = await import('./install.ts')
    await install([])

    expect(console_log_spy).toHaveBeenCalled()
    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toMatch(/install|enabled|success/i)
  })

  it('should call systemctl commands in correct order: write -> reload -> enable', async () => {
    const call_order: string[] = []

    mock_writeFileSync.mockImplementation(() => {
      call_order.push('write')
    })

    mock_execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd === 'which tsx') {
        return '/home/testuser/.local/bin/tsx'
      }
      if (typeof cmd === 'string' && cmd.includes('daemon-reload')) {
        call_order.push('daemon-reload')
      }
      if (typeof cmd === 'string' && cmd.includes('enable --now')) {
        call_order.push('enable')
      }
      if (typeof cmd === 'string' && cmd.includes('loginctl')) {
        call_order.push('loginctl')
      }
      return ''
    })

    const { install } = await import('./install.ts')
    await install([])

    expect(call_order.indexOf('write')).toBeLessThan(call_order.indexOf('daemon-reload'))
    expect(call_order.indexOf('daemon-reload')).toBeLessThan(call_order.indexOf('enable'))
  })
})
