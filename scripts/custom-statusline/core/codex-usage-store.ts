// 共用 Codex usage store（spec 36 AC10、AC23、AC25）：
// statusline 的 usage API fetch 與 OpenCode capture 都寫入同一 store，
// 兩表面讀同一份 snapshot，與 Anthropic cache 完全分離（ADR-2）。
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"

import type { CodexCredits, CodexQuotaWindow, CodexUsageSnapshot, CodexUsageSource } from "./types.ts"
import { isObservationFresh, isObservedAtPlausible, isValidUsedPercent } from "./quota-window.ts"

export type CodexUsageWriteResult = "written" | "skipped_older" | "rejected_invalid"

// 寫入方提供觀測；updated_at（寫入時間）由 store 在寫入當下蓋章（AC23 observed/updated 分離）。
export type CodexUsageObservation = Omit<CodexUsageSnapshot, "updated_at">

export interface CodexUsageStoreOptions {
  env?: Record<string, string | undefined>
  now_ms?: number
  lock_timeout_ms?: number
  lock_stale_ms?: number
}

export const DEFAULT_MAX_AGE_SECONDS = 3600
const DEFAULT_LOCK_TIMEOUT_MS = 2000
const DEFAULT_LOCK_STALE_MS = 10_000
const LOCK_RETRY_INTERVAL_MS = 15

const VALID_SOURCES: readonly CodexUsageSource[] = ["codex-usage-api", "opencode-capture"]

// spec contract 是 shell 的 ${VAR:-fallback}：空字串視同未設定。
function envValue(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key]
  return typeof value === "string" && value !== "" ? value : null
}

export function resolveCodexUsageFilePath(env: Record<string, string | undefined> = process.env): string {
  const override = envValue(env, "DDD_CODEX_USAGE_FILE")
  if (override !== null) return override
  const cache_home = envValue(env, "XDG_CACHE_HOME") ?? path.join(homedir(), ".cache")
  return path.join(cache_home, "ddd-workflow", "custom-statusline", "codex-usage.json")
}

export function resolveMaxAgeSeconds(env: Record<string, string | undefined> = process.env): number {
  const override = envValue(env, "DDD_CODEX_USAGE_MAX_AGE_SECONDS")
  if (override === null) return DEFAULT_MAX_AGE_SECONDS
  const parsed = Number(override)
  // 無法解析或非正數的 override 靜默回退預設：statusline 不該因壞 env 而整條掛掉。
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_AGE_SECONDS
  return parsed
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// 回傳 undefined 表示該欄位 invalid（整份拒收）；null 是「缺欄位」的合法值。
function validateNullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  return typeof value === "string" ? value : undefined
}

function validateNullableBoolean(value: unknown): boolean | null | undefined {
  if (value === null || value === undefined) return null
  return typeof value === "boolean" ? value : undefined
}

function validateWindow(value: unknown): CodexQuotaWindow | null | undefined {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return undefined

  const { used_percent, reset_at, window_minutes } = value

  // 百分比只接受有限 number 0–100；缺欄位是 null，不得默認 0（AC26 語意）。
  if (used_percent !== null && used_percent !== undefined && !isValidUsedPercent(used_percent)) return undefined

  // reset_at 為 epoch 秒；present 但非正有限數即整份 invalid。
  if (reset_at !== null && reset_at !== undefined) {
    if (typeof reset_at !== "number" || !Number.isFinite(reset_at) || reset_at <= 0) return undefined
  }

  if (window_minutes !== null && window_minutes !== undefined) {
    if (typeof window_minutes !== "number" || !Number.isFinite(window_minutes) || window_minutes <= 0) return undefined
  }

  return {
    used_percent: used_percent ?? null,
    reset_at: reset_at ?? null,
    window_minutes: window_minutes ?? null,
  }
}

function validateCredits(value: unknown): CodexCredits | null | undefined {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return undefined

  const has_credits = validateNullableBoolean(value.has_credits)
  const unlimited = validateNullableBoolean(value.unlimited)
  if (has_credits === undefined || unlimited === undefined) return undefined
  return { has_credits, unlimited }
}

// Validator 以白名單重建 snapshot：store 只保存 quota allowlist 欄位，
// 任何 token／credential 類欄位在這裡被丟棄（spec 非目標：不記錄 credential）。
// invalid 整份拒收（回 null），不做部分救援——unknown 比錯誤數字可信（ADR-2）。
export function validateCodexUsageSnapshot(value: unknown): CodexUsageSnapshot | null {
  if (!isRecord(value)) return null
  if (value.schema_version !== 2) return null
  if (value.provider !== "openai") return null
  if (!VALID_SOURCES.includes(value.source as CodexUsageSource)) return null
  if (!isIsoTimestamp(value.observed_at)) return null
  if (!isIsoTimestamp(value.updated_at)) return null

  const plan_type = validateNullableString(value.plan_type)
  const active_limit = validateNullableString(value.active_limit)
  const credits = validateCredits(value.credits)
  const primary = validateWindow(value.primary)
  const secondary = validateWindow(value.secondary)
  if (
    plan_type === undefined ||
    active_limit === undefined ||
    credits === undefined ||
    primary === undefined ||
    secondary === undefined
  ) {
    return null
  }

  return {
    schema_version: 2,
    provider: "openai",
    source: value.source as CodexUsageSource,
    observed_at: value.observed_at,
    updated_at: value.updated_at,
    plan_type,
    active_limit,
    credits,
    primary,
    secondary,
  }
}

// 未來超容忍的 observed_at 一律當 invalid：raw 也不外流（數字不可信），
// 且 write guard 的現值比較拿到 null，毒檔無法永久擋下後續合法觀測（AC23）。
async function readSnapshotFromFile(file_path: string, now_ms: number): Promise<CodexUsageSnapshot | null> {
  let raw: string
  try {
    raw = await readFile(file_path, "utf8")
  } catch {
    return null
  }
  let snapshot: CodexUsageSnapshot | null
  try {
    snapshot = validateCodexUsageSnapshot(JSON.parse(raw))
  } catch {
    return null
  }
  if (snapshot === null) return null
  return isObservedAtPlausible(snapshot.observed_at, now_ms) ? snapshot : null
}

// raw 讀取：stale-but-valid 也回傳，fallback 決策交呼叫端（AC16 的 stale fallback 用）。
export async function readCodexUsageRaw(options: CodexUsageStoreOptions = {}): Promise<CodexUsageSnapshot | null> {
  const env = options.env ?? process.env
  return readSnapshotFromFile(resolveCodexUsageFilePath(env), options.now_ms ?? Date.now())
}

// fresh 讀取：freshness 只以 observed_at 計（AC23），判準共用 core/quota-window。
export async function readCodexUsageFresh(options: CodexUsageStoreOptions = {}): Promise<CodexUsageSnapshot | null> {
  const env = options.env ?? process.env
  const snapshot = await readCodexUsageRaw(options)
  if (snapshot === null) return null
  const now_ms = options.now_ms ?? Date.now()
  return isObservationFresh(snapshot.observed_at, now_ms, resolveMaxAgeSeconds(env)) ? snapshot : null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// exclusive lock：以 O_EXCL create 取得；stale lock 以 mtime 判定後用 rename 回收，
// rename 只會有一個競爭者成功，避免「兩個回收者互刪對方剛建的新 lock」的競態。
async function acquireLock(lock_path: string, timeout_ms: number, stale_ms: number): Promise<void> {
  const deadline_ms = Date.now() + timeout_ms
  for (;;) {
    try {
      const handle = await open(lock_path, "wx")
      // close 放進 finally：writeFile 拋錯（如 ENOSPC）時仍關閉 handle，不洩漏 FD；
      // 非 EEXIST 錯誤照舊上拋，讓 lock 取得失敗（spec 36 Issue #1）。
      try {
        await handle.writeFile(String(process.pid))
      } finally {
        await handle.close()
      }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }

    let lock_stat
    try {
      lock_stat = await stat(lock_path)
    } catch {
      continue // lock 剛被釋放，立刻重試搶建。
    }

    if (Date.now() - lock_stat.mtimeMs > stale_ms) {
      const reclaim_path = `${lock_path}.reclaim.${process.pid}.${randomUUID()}`
      try {
        await rename(lock_path, reclaim_path)
        await rm(reclaim_path, { force: true })
      } catch {
        // 另一個競爭者已回收；回頭重試搶建即可。
      }
      continue
    }

    if (Date.now() >= deadline_ms) {
      throw new Error(`codex usage store: lock timeout after ${timeout_ms}ms (${lock_path})`)
    }
    await delay(LOCK_RETRY_INTERVAL_MS)
  }
}

function isStrictlyNewer(candidate_observed_at: string, current_observed_at: string): boolean {
  return Date.parse(candidate_observed_at) > Date.parse(current_observed_at)
}

// 寫入全段在 exclusive lock 內串行化：讀現值 → observed_at 較新才寫 →
// temp file＋atomic rename → 釋放 lock（AC25、Case 6）。
export async function writeCodexUsageSnapshot(
  observation: CodexUsageObservation,
  options: CodexUsageStoreOptions = {},
): Promise<CodexUsageWriteResult> {
  const env = options.env ?? process.env
  const now_ms = options.now_ms ?? Date.now()

  const candidate = validateCodexUsageSnapshot({
    ...observation,
    updated_at: new Date(now_ms).toISOString(),
  })
  if (candidate === null) return "rejected_invalid"
  // 未來超容忍的觀測在寫入端就拒收，毒 snapshot 不落地（AC23 clock-skew guard）。
  if (!isObservedAtPlausible(candidate.observed_at, now_ms)) return "rejected_invalid"

  const file_path = resolveCodexUsageFilePath(env)
  await mkdir(path.dirname(file_path), { recursive: true })

  const lock_path = `${file_path}.lock`
  await acquireLock(
    lock_path,
    options.lock_timeout_ms ?? DEFAULT_LOCK_TIMEOUT_MS,
    options.lock_stale_ms ?? DEFAULT_LOCK_STALE_MS,
  )
  try {
    const current = await readSnapshotFromFile(file_path, now_ms)
    // 現值 invalid／缺檔不擋寫入：corrupt store 不該永久卡死合法觀測。
    if (current !== null && !isStrictlyNewer(candidate.observed_at, current.observed_at)) {
      return "skipped_older"
    }

    const temp_path = `${file_path}.tmp.${process.pid}.${randomUUID()}`
    await writeFile(temp_path, `${JSON.stringify(candidate, null, 2)}\n`)
    await rename(temp_path, file_path)
    return "written"
  } finally {
    await rm(lock_path, { force: true })
  }
}
