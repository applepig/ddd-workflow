import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from './fuzzy-match.ts'

describe('fuzzyMatch', () => {
  it('should return exact match when input equals a candidate', () => {
    const result = fuzzyMatch('my-project', ['my-project', 'other'])

    expect(result).toEqual({ type: 'exact', matches: ['my-project'] })
  })

  it('should return unique match when only one candidate contains input as substring', () => {
    const result = fuzzyMatch('my', ['my-project', 'other'])

    expect(result).toEqual({ type: 'unique', matches: ['my-project'] })
  })

  it('should return ambiguous when multiple candidates contain input as substring', () => {
    const result = fuzzyMatch('api', ['api-server', 'api-client'])

    expect(result).toEqual({ type: 'ambiguous', matches: ['api-server', 'api-client'] })
  })

  it('should return none when no candidate matches input', () => {
    const result = fuzzyMatch('xyz', ['foo', 'bar'])

    expect(result).toEqual({ type: 'none', matches: [] })
  })

  it('should return none when candidates array is empty', () => {
    const result = fuzzyMatch('x', [])

    expect(result).toEqual({ type: 'none', matches: [] })
  })

  it('should prefer exact match over substring matches', () => {
    const result = fuzzyMatch('api', ['api', 'api-server', 'api-client'])

    expect(result).toEqual({ type: 'exact', matches: ['api'] })
  })

  it('should be case-sensitive', () => {
    const result = fuzzyMatch('API', ['api-server', 'api-client'])

    expect(result).toEqual({ type: 'none', matches: [] })
  })
})
