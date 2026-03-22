/** Restart policy，同 Docker 風格 */
export type RestartPolicy = 'always' | 'on-failure' | 'no'

/** 單一 session 的設定（存在 state file 中） */
export interface SessionConfig {
  dir: string
  restart: RestartPolicy
  created_at: string  // ISO 8601
}

/** State file 的完整結構：key 是 session 名稱 */
export interface State {
  [name: string]: SessionConfig
}

/** 模糊比對結果 */
export interface FuzzyResult {
  type: 'exact' | 'unique' | 'ambiguous' | 'none'
  matches: string[]
}
