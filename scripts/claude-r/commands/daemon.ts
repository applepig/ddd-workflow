import { loadState } from '../state.ts'
import { createSession, listSessions } from '../tmux.ts'

export interface ReconcileResult {
  checked: number
  restarted: string[]
  skipped: string[]
}

/**
 * 執行單次調和。
 * 比對 state file 與 tmux 實際狀態，重建缺失的 session。
 */
export async function reconcile(config_path?: string): Promise<ReconcileResult> {
  const state = loadState(config_path)
  const actual_sessions = listSessions()
  const actual_set = new Set(actual_sessions)

  const desired_names = Object.keys(state)
  const restarted: string[] = []
  const skipped: string[] = []

  for (const name of desired_names) {
    if (actual_set.has(name)) {
      continue
    }

    const config = state[name]

    if (config.restart === 'no') {
      skipped.push(name)
      continue
    }

    // restart: 'always' | 'on-failure' → 重建（v1 不區分 exit code）
    // TODO: v2 實作 exit code 檢查，on-failure 只在非零退出時才重建
    createSession(name, config.dir, name)
    restarted.push(name)
  }

  return {
    checked: desired_names.length,
    restarted,
    skipped,
  }
}

/**
 * 執行 daemon loop（由 systemd 呼叫，無限 loop）。
 * 每 interval_ms 毫秒執行一次 reconcile。
 */
export async function runDaemon(config_path?: string, interval_ms = 5000): Promise<never> {
  console.log('claude-r daemon started')
  while (true) {
    try {
      const result = await reconcile(config_path)
      if (result.restarted.length > 0) {
        console.log(`[${new Date().toISOString()}] Restarted: ${result.restarted.join(', ')}`)
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}] Reconcile error: ${err.message}`)
    }
    await new Promise(resolve => setTimeout(resolve, interval_ms))
  }
}
