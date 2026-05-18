import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as os from 'node:os'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/user'),
}))

import { renderMenu, handleInput, shortenDir, parseKey } from './main.ts'
import type { SessionInfo } from './tmux.ts'
import type { MenuState, MenuAction } from './main.ts'

describe('parseKey', () => {
  it('should return CTRL_C for byte 3', () => {
    expect(parseKey(Buffer.from([3]))).toBe('CTRL_C')
  })

  it('should return ENTER for byte 13', () => {
    expect(parseKey(Buffer.from([13]))).toBe('ENTER')
  })

  it('should return UP for escape sequence [A', () => {
    expect(parseKey(Buffer.from([27, 91, 65]))).toBe('UP')
  })

  it('should return DOWN for escape sequence [B', () => {
    expect(parseKey(Buffer.from([27, 91, 66]))).toBe('DOWN')
  })

  it('should return character string for regular keys', () => {
    expect(parseKey(Buffer.from('1'))).toBe('1')
    expect(parseKey(Buffer.from('q'))).toBe('q')
  })

  it('should return raw string for unknown escape sequences', () => {
    // Escape + [ + C (right arrow) - not handled, returns raw
    const result = parseKey(Buffer.from([27, 91, 67]))
    expect(result).toBe(Buffer.from([27, 91, 67]).toString('utf-8'))
  })
})

describe('shortenDir', () => {
  it('should replace home directory with ~', () => {
    expect(shortenDir('/home/user/projects/AGENTS')).toBe('~/projects/AGENTS')
  })

  it('should return path unchanged when not under home', () => {
    expect(shortenDir('/tmp/foo')).toBe('/tmp/foo')
  })

  it('should handle exact home directory', () => {
    expect(shortenDir('/home/user')).toBe('~')
  })
})

describe('renderMenu', () => {
  const sessions: SessionInfo[] = [
    { name: 'cr-AGENTS', dir: '/home/user/Dropbox/projects/AGENTS' },
    { name: 'cr-aistudio', dir: '/home/user/Dropbox/projects/5-aistudio' },
  ]

  it('should include title', () => {
    const output = renderMenu(sessions, '/home/user/projects/foo', 0)

    expect(output).toContain('Claude Code Sessions')
  })

  it('should list existing sessions with number labels', () => {
    const output = renderMenu(sessions, '/home/user/projects/foo', 0)

    expect(output).toContain('[1]')
    expect(output).toContain('cr-AGENTS')
    expect(output).toContain('[2]')
    expect(output).toContain('cr-aistudio')
  })

  it('should show shortened directory paths', () => {
    const output = renderMenu(sessions, '/home/user/projects/foo', 0)

    expect(output).toContain('~/Dropbox/projects/AGENTS')
    expect(output).toContain('~/Dropbox/projects/5-aistudio')
  })

  it('should include cc and oc options', () => {
    const output = renderMenu(sessions, '/home/user/projects/foo', 0)

    expect(output).toContain('Start cc here')
    expect(output).toContain('Start oc here')
    expect(output).toContain('[3]')
    expect(output).toContain('[4]')
  })

  it('should show current directory in new session option', () => {
    const output = renderMenu(sessions, '/home/user/projects/foo', 0)

    expect(output).toContain('~/projects/foo')
  })

  it('should use filled dot for existing sessions', () => {
    const output = renderMenu(sessions, '/tmp', 0)

    expect(output).toContain('●')
  })

  it('should use empty dot for new session option', () => {
    const output = renderMenu(sessions, '/tmp', 0)

    expect(output).toContain('○')
  })

  it('should highlight selected item', () => {
    const output_first = renderMenu(sessions, '/tmp', 0)
    const output_second = renderMenu(sessions, '/tmp', 1)

    // The selected item should have a different visual indicator
    // First item selected
    expect(output_first).toContain('>')
    // When checking second item, the highlight moves
    const lines_first = output_first.split('\n')
    const lines_second = output_second.split('\n')
    const highlighted_first = lines_first.filter((l) => l.includes('>'))
    const highlighted_second = lines_second.filter((l) => l.includes('>'))

    expect(highlighted_first.length).toBeGreaterThan(0)
    expect(highlighted_second.length).toBeGreaterThan(0)
    // They should highlight different items
    expect(highlighted_first[0]).not.toBe(highlighted_second[0])
  })

  it('should show footer with navigation hints including terminate and restart', () => {
    const output = renderMenu(sessions, '/tmp', 0)

    expect(output).toContain('↑↓')
    expect(output).toContain('Enter')
    expect(output).toContain('x 終止')
    expect(output).toContain('r 重啟')
    expect(output).toContain('q')
  })

  it('should handle empty sessions list with cc and oc options', () => {
    const output = renderMenu([], '/home/user/projects/foo', 0)

    expect(output).toContain('[1]')
    expect(output).toContain('Start cc here')
    expect(output).toContain('[2]')
    expect(output).toContain('Start oc here')
  })
})

describe('handleInput', () => {
  const sessions: SessionInfo[] = [
    { name: 'cr-AGENTS', dir: '/home/user/projects/AGENTS' },
    { name: 'cr-aistudio', dir: '/home/user/projects/aistudio' },
  ]
  const total_items = 4 // 2 sessions + 2 new (cc + oc)

  describe('number keys', () => {
    it('should select session when pressing valid number', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('1', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'attach', session_name: 'cr-AGENTS' })
    })

    it('should select second session when pressing 2', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('2', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'attach', session_name: 'cr-aistudio' })
    })

    it('should create cc session when pressing 3', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('3', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'create', dir: '/tmp', tool: 'cc' })
    })

    it('should create oc session when pressing 4', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('4', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'create', dir: '/tmp', tool: 'oc' })
    })

    it('should ignore number out of range', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('9', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'none' })
    })

    it('should ignore 0', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('0', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'none' })
    })
  })

  describe('arrow keys', () => {
    it('should move selection down on down arrow', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('DOWN', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'move', selected: 1 })
    })

    it('should move selection up on up arrow', () => {
      const state: MenuState = { selected: 1, total: total_items }
      const action = handleInput('UP', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'move', selected: 0 })
    })

    it('should wrap to bottom when pressing up at top', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('UP', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'move', selected: total_items - 1 })
    })

    it('should wrap to top when pressing down at bottom', () => {
      const state: MenuState = { selected: total_items - 1, total: total_items }
      const action = handleInput('DOWN', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'move', selected: 0 })
    })
  })

  describe('enter key', () => {
    it('should attach to selected session on enter', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('ENTER', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'attach', session_name: 'cr-AGENTS' })
    })

    it('should create cc session when enter on cc option', () => {
      const state: MenuState = { selected: 2, total: total_items }
      const action = handleInput('ENTER', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'create', dir: '/tmp', tool: 'cc' })
    })

    it('should create oc session when enter on oc option', () => {
      const state: MenuState = { selected: 3, total: total_items }
      const action = handleInput('ENTER', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'create', dir: '/tmp', tool: 'oc' })
    })
  })

  describe('quit', () => {
    it('should quit on q', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('q', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'quit' })
    })

    it('should quit on CTRL_C', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('CTRL_C', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'quit' })
    })
  })

  describe('terminate (x key)', () => {
    it('should return terminate action when pressing x on existing session', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('x', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'terminate', session_name: 'cr-AGENTS' })
    })

    it('should return terminate for second session when selected', () => {
      const state: MenuState = { selected: 1, total: total_items }
      const action = handleInput('x', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'terminate', session_name: 'cr-aistudio' })
    })

    it('should return none when pressing x on cc option', () => {
      const state: MenuState = { selected: 2, total: total_items }
      const action = handleInput('x', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'none' })
    })

    it('should return none when pressing x on oc option', () => {
      const state: MenuState = { selected: 3, total: total_items }
      const action = handleInput('x', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'none' })
    })
  })

  describe('restart (r key)', () => {
    it('should return restart action when pressing r on existing session', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('r', state, sessions, '/tmp')

      expect(action).toEqual({
        type: 'restart',
        session_name: 'cr-AGENTS',
        dir: '/home/user/projects/AGENTS',
      })
    })

    it('should return restart for second session when selected', () => {
      const state: MenuState = { selected: 1, total: total_items }
      const action = handleInput('r', state, sessions, '/tmp')

      expect(action).toEqual({
        type: 'restart',
        session_name: 'cr-aistudio',
        dir: '/home/user/projects/aistudio',
      })
    })

    it('should return none when pressing r on cc option', () => {
      const state: MenuState = { selected: 2, total: total_items }
      const action = handleInput('r', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'none' })
    })

    it('should return none when pressing r on oc option', () => {
      const state: MenuState = { selected: 3, total: total_items }
      const action = handleInput('r', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'none' })
    })
  })

  describe('unknown keys', () => {
    it('should return none for unrecognized input', () => {
      const state: MenuState = { selected: 0, total: total_items }
      const action = handleInput('z', state, sessions, '/tmp')

      expect(action).toEqual({ type: 'none' })
    })
  })
})
