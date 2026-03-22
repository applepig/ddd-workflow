import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { loadState, saveState } from './state.ts'
import type { State } from './types.ts'

describe('state', () => {
  let tmp_dir: string

  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-r-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
  })

  describe('loadState', () => {
    it('should return empty object when file does not exist', () => {
      const state_path = path.join(tmp_dir, 'nonexistent', 'sessions.json')

      const result = loadState(state_path)

      expect(result).toEqual({})
    })

    it('should return parsed state when file contains valid JSON', () => {
      const state_path = path.join(tmp_dir, 'sessions.json')
      const expected: State = {
        'my-project': {
          dir: '/home/user/projects/my-project',
          restart: 'always',
          created_at: '2026-03-22T10:00:00Z',
        },
      }
      fs.writeFileSync(state_path, JSON.stringify(expected, null, 2))

      const result = loadState(state_path)

      expect(result).toEqual(expected)
    })

    it('should throw Error with meaningful message when file contains invalid JSON', () => {
      const state_path = path.join(tmp_dir, 'sessions.json')
      fs.writeFileSync(state_path, '{ invalid json !!!')

      expect(() => loadState(state_path)).toThrowError(/failed to parse/i)
    })
  })

  describe('saveState', () => {
    it('should write state that can be read back identically', () => {
      const state_path = path.join(tmp_dir, 'sessions.json')
      const state: State = {
        'api-server': {
          dir: '/home/user/api-server',
          restart: 'on-failure',
          created_at: '2026-03-22T12:00:00Z',
        },
        'web-app': {
          dir: '/home/user/web-app',
          restart: 'no',
          created_at: '2026-03-22T13:00:00Z',
        },
      }

      saveState(state, state_path)
      const result = loadState(state_path)

      expect(result).toEqual(state)
    })

    it('should create parent directories when they do not exist', () => {
      const state_path = path.join(tmp_dir, 'deep', 'nested', 'dir', 'sessions.json')

      const state: State = {
        test: {
          dir: '/tmp/test',
          restart: 'always',
          created_at: '2026-03-22T14:00:00Z',
        },
      }

      saveState(state, state_path)

      expect(fs.existsSync(state_path)).toBe(true)
      const result = loadState(state_path)
      expect(result).toEqual(state)
    })

    it('should write with 2-space indent pretty print', () => {
      const state_path = path.join(tmp_dir, 'sessions.json')
      const state: State = {
        test: {
          dir: '/tmp/test',
          restart: 'always',
          created_at: '2026-03-22T15:00:00Z',
        },
      }

      saveState(state, state_path)
      const raw_content = fs.readFileSync(state_path, 'utf-8')

      expect(raw_content).toBe(JSON.stringify(state, null, 2) + '\n')
    })
  })
})
