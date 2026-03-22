import type { FuzzyResult } from './types.ts'

/**
 * 模糊比對 session 名稱。
 * 1. 完全匹配 → { type: 'exact', matches: [input] }
 * 2. 部分匹配（substring）唯一 → { type: 'unique', matches: [candidate] }
 * 3. 多個匹配 → { type: 'ambiguous', matches: [...] }
 * 4. 無匹配 → { type: 'none', matches: [] }
 */
export function fuzzyMatch(input: string, candidates: string[]): FuzzyResult {
  const exact = candidates.find((c) => c === input)
  if (exact) {
    return { type: 'exact', matches: [exact] }
  }

  const substring_matches = candidates.filter((c) => c.includes(input))

  if (substring_matches.length === 0) {
    return { type: 'none', matches: [] }
  }

  if (substring_matches.length === 1) {
    return { type: 'unique', matches: substring_matches }
  }

  return { type: 'ambiguous', matches: substring_matches }
}
