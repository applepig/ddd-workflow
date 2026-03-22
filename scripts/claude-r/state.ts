import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { State } from './types.ts'

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-r')
const DEFAULT_STATE_PATH = path.join(DEFAULT_CONFIG_DIR, 'sessions.json')

/**
 * 讀取 state file。
 * - 檔案不存在 → 回傳 {}
 * - 檔案存在但非法 JSON → throw Error
 */
export function loadState(config_path: string = DEFAULT_STATE_PATH): State {
  if (!fs.existsSync(config_path)) {
    return {}
  }

  const raw = fs.readFileSync(config_path, 'utf-8')

  try {
    return JSON.parse(raw) as State
  } catch {
    throw new Error(`Failed to parse state file: ${config_path}`)
  }
}

/**
 * 寫入 state file。
 * - 目錄不存在時自動建立
 * - 以 2-space indent pretty print
 */
export function saveState(state: State, config_path: string = DEFAULT_STATE_PATH): void {
  const dir = path.dirname(config_path)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const content = JSON.stringify(state, null, 2) + '\n'
  fs.writeFileSync(config_path, content)
}
