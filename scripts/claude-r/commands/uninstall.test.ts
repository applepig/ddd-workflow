import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as child_process from 'node:child_process'
import * as os from 'node:os'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    unlinkSync: vi.fn(),
    existsSync: vi.fn(() => true),
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
    homedir: vi.fn(() => '/home/testuser'),
  }
})

const mock_unlinkSync = vi.mocked(fs.unlinkSync)
const mock_existsSync = vi.mocked(fs.existsSync)
const mock_execSync = vi.mocked(child_process.execSync)
const mock_homedir = vi.mocked(os.homedir)

describe('uninstall command', () => {
  let console_log_spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mock_homedir.mockReturnValue('/home/testuser')
    mock_existsSync.mockReturnValue(true)
    mock_execSync.mockReturnValue('')
    console_log_spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('should call systemctl disable --now claude-r.service', async () => {
    const { uninstall } = await import('./uninstall.ts')
    await uninstall([])

    expect(mock_execSync).toHaveBeenCalledWith(
      'systemctl --user disable --now claude-r.service'
    )
  })

  it('should remove service file from correct path', async () => {
    const { uninstall } = await import('./uninstall.ts')
    await uninstall([])

    expect(mock_unlinkSync).toHaveBeenCalledWith(
      '/home/testuser/.config/systemd/user/claude-r.service'
    )
  })

  it('should call systemctl daemon-reload after removing file', async () => {
    const { uninstall } = await import('./uninstall.ts')
    await uninstall([])

    expect(mock_execSync).toHaveBeenCalledWith('systemctl --user daemon-reload')
  })

  it('should execute in correct order: disable -> remove -> reload', async () => {
    const call_order: string[] = []

    mock_execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('disable --now')) {
        call_order.push('disable')
      }
      if (typeof cmd === 'string' && cmd.includes('daemon-reload')) {
        call_order.push('daemon-reload')
      }
      return ''
    })

    mock_unlinkSync.mockImplementation(() => {
      call_order.push('unlink')
    })

    const { uninstall } = await import('./uninstall.ts')
    await uninstall([])

    expect(call_order.indexOf('disable')).toBeLessThan(call_order.indexOf('unlink'))
    expect(call_order.indexOf('unlink')).toBeLessThan(call_order.indexOf('daemon-reload'))
  })

  it('should not throw when service file does not exist', async () => {
    mock_existsSync.mockReturnValue(false)

    const { uninstall } = await import('./uninstall.ts')

    await expect(uninstall([])).resolves.not.toThrow()
  })

  it('should not attempt to remove file when it does not exist', async () => {
    mock_existsSync.mockReturnValue(false)

    const { uninstall } = await import('./uninstall.ts')
    await uninstall([])

    expect(mock_unlinkSync).not.toHaveBeenCalled()
  })

  it('should output success message', async () => {
    const { uninstall } = await import('./uninstall.ts')
    await uninstall([])

    expect(console_log_spy).toHaveBeenCalled()
    const output = console_log_spy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toMatch(/uninstall|removed|disabled/i)
  })

  it('should still call disable and reload even when file does not exist', async () => {
    mock_existsSync.mockReturnValue(false)

    const { uninstall } = await import('./uninstall.ts')
    await uninstall([])

    expect(mock_execSync).toHaveBeenCalledWith(
      'systemctl --user disable --now claude-r.service'
    )
    expect(mock_execSync).toHaveBeenCalledWith('systemctl --user daemon-reload')
  })

  it('should not throw when systemctl disable fails (idempotent uninstall)', async () => {
    mock_execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('disable --now')) {
        throw new Error('Unit claude-r.service not loaded.')
      }
      return ''
    })

    const { uninstall } = await import('./uninstall.ts')

    await expect(uninstall([])).resolves.not.toThrow()
  })

  it('should still remove file and reload after systemctl disable fails', async () => {
    mock_execSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('disable --now')) {
        throw new Error('Unit claude-r.service not loaded.')
      }
      return ''
    })

    const { uninstall } = await import('./uninstall.ts')
    await uninstall([])

    expect(mock_unlinkSync).toHaveBeenCalledWith(
      '/home/testuser/.config/systemd/user/claude-r.service'
    )
    expect(mock_execSync).toHaveBeenCalledWith('systemctl --user daemon-reload')
  })
})
