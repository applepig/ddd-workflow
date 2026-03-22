import { describe, it, expect } from 'vitest'
import { resolveName } from './resolve-name.ts'
import type { State } from './types.ts'

describe('resolveName', () => {
  const state: State = {
    'api-server': { dir: '/a', restart: 'always', created_at: '2025-01-01T00:00:00Z' },
    'api-client': { dir: '/b', restart: 'no', created_at: '2025-01-01T00:00:00Z' },
    'web-app': { dir: '/c', restart: 'on-failure', created_at: '2025-01-01T00:00:00Z' },
  }

  it('should return the name on exact match', () => {
    const result = resolveName('api-server', state)

    expect(result).toBe('api-server')
  })

  it('should return the name on unique fuzzy match', () => {
    const result = resolveName('web', state)

    expect(result).toBe('web-app')
  })

  it('should throw error with candidate list on ambiguous match', () => {
    expect(() => resolveName('api', state)).toThrow('Ambiguous')
    expect(() => resolveName('api', state)).toThrow('api-server')
    expect(() => resolveName('api', state)).toThrow('api-client')
  })

  it('should throw error on no match', () => {
    expect(() => resolveName('nonexistent', state)).toThrow('not found')
  })
})
