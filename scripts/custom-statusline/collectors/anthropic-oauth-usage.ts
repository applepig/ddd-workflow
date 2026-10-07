// Anthropic OAuth Usage collector（spec 36 AC5 collector 部分、AC9）。
// 語意自 scripts/claude/statusline.sh 的 getOAuthToken／isUsageResponseValid／
// readUsableUsageCache／fetchUsageAPI／parseUsageResponse 逐條移植；
// 背景 refresher daemon 已退役（ADR-6），本模組不含 pid／lock／loop。
//
// 這裡的 cache 一律是「Anthropic usage cache」（AC9）：路徑與 schema 維持
// Bash 時代原樣，與 Codex 的 shared store 完全分離（ADR-2）。
import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { isValidUsedPercent } from "../core/quota-window.ts"

export interface AnthropicUsageWindow {
  utilization: number
  resets_at?: string | number | null
}

// Usage API raw response（cache 檔內容同 schema，AC9 schema 不變）。
// extra_usage 的 jq 判準只要求 object，欄位由 parseUsageResponse 逐一 safe 取值。
export interface AnthropicUsageResponse {
  five_hour: AnthropicUsageWindow
  seven_day?: AnthropicUsageWindow | null
  extra_usage?: Record<string, unknown> | null
}

// parseUsageResponse 的產物：Bash 版輸出 shell 變數，TS 版輸出結構化物件；
// 缺值語意維持 Bash parity（utilization 0、resets_at 缺＝null、extra disabled）。
export interface AnthropicUsage {
  five_hour: { utilization: number; resets_at: string | null }
  seven_day: { utilization: number; resets_at: string | null }
  extra: { is_enabled: boolean; utilization: number; used_credits: number; monthly_limit: number }
}

// fetch／clock／fs 路徑全部可注入：測試不打真網路、用 temp dir。
export interface AnthropicOauthUsageOptions {
  env?: Record<string, string | undefined>
  now_ms?: number
  fetch_fn?: typeof fetch
}

export const ANTHROPIC_USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage"
// Bash 常數 CACHE_MAX_AGE=60：throttle 週期，60s 內的重複 render 不重打 API。
export const ANTHROPIC_USAGE_CACHE_MAX_AGE_SECONDS = 60
// Bash 常數 CACHE_STALE_MAX_AGE=300：fetch 失敗時 fallback 舊 cache 的最大容忍秒數。
export const ANTHROPIC_USAGE_CACHE_STALE_MAX_AGE_SECONDS = 300
// curl --max-time 5 的 parity。
export const ANTHROPIC_USAGE_FETCH_TIMEOUT_MS = 5000

// shell ${VAR:=default} 語意：空字串視同未設定。
function envValue(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key]
  return typeof value === "string" && value !== "" ? value : null
}

export function resolveAnthropicCacheFilePath(env: Record<string, string | undefined> = process.env): string {
  return envValue(env, "STATUSLINE_CACHE_FILE") ?? "/tmp/claude/statusline-usage-cache.json"
}

// throttle 檔跨 process 共享（多 session 併發保護），路徑跟著 cache 目錄走。
export function resolveAnthropicThrottleFilePath(env: Record<string, string | undefined> = process.env): string {
  return path.join(path.dirname(resolveAnthropicCacheFilePath(env)), "statusline-usage.throttle")
}

export function resolveAnthropicCredentialsFilePath(env: Record<string, string | undefined> = process.env): string {
  return envValue(env, "STATUSLINE_CREDENTIALS_FILE") ?? path.join(homedir(), ".claude", ".credentials.json")
}

// 依優先序讀取 OAuth token：env CLAUDE_CODE_OAUTH_TOKEN → credentials 檔的
// claudeAiOauth.accessToken；缺少或 malformed 一律回 null（Bash 回空字串）。
export async function getOAuthToken(options: AnthropicOauthUsageOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env
  const env_token = envValue(env, "CLAUDE_CODE_OAUTH_TOKEN")
  if (env_token !== null) return env_token

  let raw: string
  try {
    raw = await readFile(resolveAnthropicCredentialsFilePath(env), "utf8")
  } catch {
    return null
  }
  try {
    const credentials = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown } } | null
    const token = credentials?.claudeAiOauth?.accessToken
    return typeof token === "string" && token !== "" ? token : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// jq reset_ok：null（含缺欄位）／string／number。
function isResetAtOk(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string" || typeof value === "number"
}

// jq window_ok：object 且 utilization 為 0–100 number、resets_at reset_ok。
function isWindowOk(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isValidUsedPercent(value.utilization) && isResetAtOk(value.resets_at)
}

export function isUsageResponseValid(value: unknown): value is AnthropicUsageResponse {
  if (!isRecord(value)) return false
  if (!isWindowOk(value.five_hour)) return false
  const { seven_day, extra_usage } = value
  if (seven_day !== null && seven_day !== undefined && !isWindowOk(seven_day)) return false
  if (extra_usage !== null && extra_usage !== undefined && !isRecord(extra_usage)) return false
  return true
}

// Bash 以秒為粒度比較 stat mtime 與 date +%s；檔案缺失回 null。
async function fileAgeSeconds(file_path: string, now_ms: number): Promise<number | null> {
  let file_stat
  try {
    file_stat = await stat(file_path)
  } catch {
    return null
  }
  return Math.floor(now_ms / 1000) - Math.floor(file_stat.mtimeMs / 1000)
}

// 寫檔後把 mtime 蓋成注入的 now：throttle／cache 的 age 判準才能完全由注入時鐘決定。
async function writeFileWithMtime(file_path: string, content: string, now_ms: number): Promise<void> {
  await writeFile(file_path, content)
  const mtime = new Date(now_ms)
  await utimes(file_path, mtime, mtime)
}

// cache 目錄與 throttle／cache 的副作用寫入一律 best-effort（silent fail）：寫入失敗
// （權限、ENOSPC、parent 非目錄）不該讓 live fetch 與 render 整條掛掉——資料已在手，
// 繼續用（使用者裁決：error 跳 silent fail、繼續用 last state）。與 entry appendLogLine 同慣例。
async function bestEffort(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch {
    // 吞掉：副作用寫入失敗不是 render 失敗的理由。
  }
}

// 讀「時間與數字都合理」的 Anthropic usage cache；任一不滿足回 null。
// age >= max_age 即拒用（Bash 邊界為 >=）。
export async function readUsableUsageCache(
  max_age_seconds: number,
  options: AnthropicOauthUsageOptions = {},
): Promise<AnthropicUsageResponse | null> {
  const env = options.env ?? process.env
  const now_ms = options.now_ms ?? Date.now()
  const cache_path = resolveAnthropicCacheFilePath(env)

  const age = await fileAgeSeconds(cache_path, now_ms)
  if (age === null || age >= max_age_seconds) return null

  let raw: string
  try {
    raw = await readFile(cache_path, "utf8")
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return isUsageResponseValid(parsed) ? parsed : null
}

// live-first 呼叫 Usage API；只有 throttle 併發保護或 API 打不到時才 fallback cache。
// throttle 檔 mtime 記錄上次請求時間，60s 內避免多 session 重複請求（AC5）。
export async function fetchAnthropicUsage(
  token: string | null,
  options: AnthropicOauthUsageOptions = {},
): Promise<AnthropicUsageResponse | null> {
  // 無 token 時不呼叫 API（Bash 直接回空，不走 cache fallback）。
  if (token === null || token === "") return null

  const env = options.env ?? process.env
  const now_ms = options.now_ms ?? Date.now()
  const fetch_fn = options.fetch_fn ?? fetch
  const cache_path = resolveAnthropicCacheFilePath(env)
  const throttle_path = resolveAnthropicThrottleFilePath(env)

  await bestEffort(() => mkdir(path.dirname(cache_path), { recursive: true }))

  // throttle 新鮮：其他 session 近期已請求過，改用 stale 容忍內的 cache，避免併發打爆 API。
  const throttle_age = await fileAgeSeconds(throttle_path, now_ms)
  if (throttle_age !== null && throttle_age < ANTHROPIC_USAGE_CACHE_MAX_AGE_SECONDS) {
    return readUsableUsageCache(ANTHROPIC_USAGE_CACHE_STALE_MAX_AGE_SECONDS, options)
  }

  // 先標記再 fetch：即使 fetch 失敗，throttle 週期內也不重打（Bash touch 順序 parity）。
  await bestEffort(() => writeFileWithMtime(throttle_path, "", now_ms))

  // curl --silent parity：HTTP 錯誤狀態不擋，body 一律交給 validator 過濾。
  let body: string | null = null
  try {
    const response = await fetch_fn(ANTHROPIC_USAGE_API_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(ANTHROPIC_USAGE_FETCH_TIMEOUT_MS),
    })
    body = await response.text()
  } catch {
    body = null
  }

  if (body !== null && body !== "") {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = null
    }
    if (parsed !== null && isUsageResponseValid(parsed)) {
      // 資料已在手：cache 寫入 best-effort，寫不進去仍回傳 live 結果（silent fail、last state）。
      await bestEffort(() => writeFileWithMtime(cache_path, body, now_ms))
      return parsed
    }
  }

  // API 失敗：fallback 到時間與數字都合理的舊 cache；完全沒有資料回 null。
  return readUsableUsageCache(ANTHROPIC_USAGE_CACHE_STALE_MAX_AGE_SECONDS, options)
}

// jq safe_num parity：null／缺欄位→0。
function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

// jq safe_str parity：null／空→缺值（Bash 用空字串，TS 用 null）；number 走 tostring。
// resets_at 的注入問題在 TS 天然免疫，但 string／number 以外的 invalid 型別仍拒收。
function safeResetsAt(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

export function parseUsageResponse(response: AnthropicUsageResponse | null): AnthropicUsage {
  const five_hour = response?.five_hour ?? null
  const seven_day = response?.seven_day ?? null
  const extra_usage = response?.extra_usage ?? null

  return {
    five_hour: {
      utilization: safeNumber(five_hour?.utilization),
      resets_at: safeResetsAt(five_hour?.resets_at),
    },
    seven_day: {
      utilization: safeNumber(seven_day?.utilization),
      resets_at: safeResetsAt(seven_day?.resets_at),
    },
    extra: {
      // jq safe_bool parity：只有 === true 才是 true。
      is_enabled: extra_usage?.is_enabled === true,
      utilization: safeNumber(extra_usage?.utilization),
      used_credits: safeNumber(extra_usage?.used_credits),
      monthly_limit: safeNumber(extra_usage?.monthly_limit),
    },
  }
}

export interface AnthropicUsageResult extends AnthropicUsage {
  // true = 值取自超過 300 秒 stale 容忍的舊 cache（AC39）；顯示層據此標示 DIM。
  is_stale: boolean
}

// AC39 的最後手段：live fetch 與 300 秒 cache 都拿不到時，讀「payload 合法」的最後一次
// cache，不設時間上限。值是否仍有意義由 window 是否過 reset 決定——那是顯示層的判斷。
export async function readLastResortUsageCache(
  options: AnthropicOauthUsageOptions = {},
): Promise<AnthropicUsageResponse | null> {
  return readUsableUsageCache(Number.POSITIVE_INFINITY, options)
}

// collector 入口：token → live-first fetch → parse；全失敗才退到 stale cache（AC39）。
// 同 reset window「較新／較高 observation」的 merge 規則屬 render 層（M2），不在本 collector。
export async function collectAnthropicOauthUsage(
  options: AnthropicOauthUsageOptions = {},
): Promise<AnthropicUsageResult> {
  const token = await getOAuthToken(options)
  const response = await fetchAnthropicUsage(token, options)
  if (response !== null) return { ...parseUsageResponse(response), is_stale: false }

  // 無 token 時 fetchAnthropicUsage 根本沒打 API（Bash parity：直接回空、不碰 cache），
  // 因此也不進 stale fallback——否則「沒登入」會顯示上一個帳號的舊數字。
  if (token === null || token === "") return { ...parseUsageResponse(null), is_stale: false }

  const stale = await readLastResortUsageCache(options)
  if (stale === null) return { ...parseUsageResponse(null), is_stale: false }
  return { ...parseUsageResponse(stale), is_stale: true }
}
