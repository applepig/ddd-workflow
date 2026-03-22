import { fuzzyMatch } from './fuzzy-match.ts'
import type { State } from './types.ts'

/**
 * 從 input 模糊比對 state 中的 session name。
 * exact / unique → 回傳 match
 * ambiguous → throw 含候選列表
 * none → throw not found
 */
export function resolveName(input: string, state: State): string {
  const result = fuzzyMatch(input, Object.keys(state))

  switch (result.type) {
    case 'exact':
    case 'unique':
      return result.matches[0]
    case 'ambiguous':
      throw new Error(`Ambiguous name "${input}". Did you mean:\n${result.matches.map(m => `  - ${m}`).join('\n')}`)
    case 'none':
      throw new Error(`Session "${input}" not found.`)
  }
}
