// Claude statusline TS entrypoint（spec 36 M2：AC4 遷移 parity、AC8 非 claude-* 暫時行為）。
//
// 流程：stdin StatusJSON → collectors（claude-status-json）→ resolve-provider 路由 →
// Anthropic 分支（anthropic-oauth-usage collector：live-first、60s throttle、300s stale
// fallback）＋同 reset window merge 規則（statusline.sh 534–555、676–700 行 parity）→
// presenter → 完整 stdout 字串。
//
// 背景 refresher daemon 已退役（AC6、ADR-6）：不建 pid file、不建 lock dir、不 spawn。
//
// 介面契約（golden 測試依此驅動）：
// - 輸入：stdin 的 StatusJSON 原始字串。
// - 輸出：完整 statusline 畫面（含 ANSI 色碼與 NBSP，行間 \n，無 trailing newline）。
// - fetch／clock／env／git 全部可注入；bin 殼（stdin 讀取、process.stdout 寫出、
//   `#!/usr/bin/env node` shebang）在 claude-statusline-bin.ts，build 接線另行處理。
// - reset 時刻（%a %H:%M）的格式化時區使用 options.env.TZ（golden fixtures 以 UTC 擷取）。
import { execFileSync } from "node:child_process"
import { appendFile, mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises"
import path from "node:path"

import { collectAnthropicOauthUsage } from "../collectors/anthropic-oauth-usage.ts"
import { parseClaudeStatusJson } from "../collectors/claude-status-json.ts"
import type { StatusJsonContextWindow } from "../collectors/claude-status-json.ts"
import { fetchCodexUsage } from "../collectors/codex-usage-api.ts"
import type { FetchLike } from "../collectors/codex-usage-api.ts"
import {
  readCodexUsageFresh,
  resolveCodexUsageFilePath,
  writeCodexUsageSnapshot,
} from "../core/codex-usage-store.ts"
import {
  STATUSLINE_WINDOW_LABEL_OVERRIDES,
  isValidUsedPercent,
  isWindowActive,
  windowLabel,
} from "../core/quota-window.ts"
import { resolveModelDisplayName, resolveProvider } from "../core/resolve-provider.ts"
import type { CodexQuotaWindow } from "../core/types.ts"
import {
  formatModel,
  formatTokens,
  normalizePct,
  renderStatuslineView,
} from "../presenters/claude-statusline.ts"
import type { StatuslineBarRowView, StatuslineGitView } from "../presenters/claude-statusline.ts"

type EnvMap = Record<string, string | undefined>

// git 呼叫可注入（測試用）；預設同步呼叫 git CLI，stderr 靜音（bash 2>/dev/null parity）。
export type GitRunner = (args: string[]) => string

export interface StatuslineRenderOptions {
  // shell env parity：STATUSLINE_CACHE_FILE／STATUSLINE_CREDENTIALS_FILE／
  // CLAUDE_CODE_OAUTH_TOKEN／TZ 等；預設 process.env。
  env?: EnvMap
  // 注入時鐘（epoch ms）；預設 Date.now()。session 倒數與 cache freshness 都以此計。
  now_ms?: number
  // 注入 fetch（Anthropic OAuth Usage API 用）；預設 global fetch。
  fetch_fn?: typeof fetch
  // 注入 Codex usage API 的 fetch 與 auth 檔路徑（測試隔離用）；
  // 預設 global fetch 與 ~/.codex/auth.json（collector 內建）。
  codex_fetch_fn?: FetchLike
  codex_auth_file_path?: string
  // 呼叫端工作目錄；StatusJSON 缺 project_dir／cwd 時的最後 fallback。
  cwd?: string
  git_runner?: GitRunner
}

// bash CONTEXT_CAP=250000：Context 分母上限。
const CONTEXT_CAP = 250000

const DEFAULT_INVOCATION_LOG_PATH = "/tmp/claude/statusline-invocations.log"
const DEFAULT_INPUT_LOG_PATH = "/tmp/claude/statusline-input.jsonl"

export async function renderStatusline(
  stdin_input: string,
  options: StatuslineRenderOptions = {},
): Promise<string> {
  const env = options.env ?? process.env
  const now_ms = options.now_ms ?? Date.now()

  const status = parseClaudeStatusJson(stdin_input)
  await logStatuslineInput(stdin_input, env, now_ms)

  // 路由只認 model id（ADR-1）；parse 失敗或缺 model → unknown。
  const provider = resolveProvider(status.model)
  const model_id = status.model?.id ?? ""

  // Context row（AC14）：一律只用 StatusJSON 的 context_window。
  // v5 AC33：per-session carry-forward 遮蔽 GPT 工具執行期間的暫態歸零（Context row only，
  // 不觸碰任何 quota 來源）。
  const ctx_tokens = await resolveContextTokens(computeContextTokens(status.context_window), status.session_id, env)
  const ctx_window_size = status.context_window?.context_window_size ?? 0
  const ctx_max = ctx_window_size > 0 && ctx_window_size < CONTEXT_CAP ? ctx_window_size : CONTEXT_CAP
  const ctx_pct = normalizePct(Math.floor((ctx_tokens * 100) / ctx_max))

  const five_hour = readRateLimitWindow(status.rate_limits, "five_hour")
  const seven_day = readRateLimitWindow(status.rate_limits, "seven_day")
  const status_weekly_pct = normalizePct(seven_day.used_pct)

  let session_pct = five_hour.used_pct
  let session_resets_at = five_hour.resets_at
  let weekly_pct = 0
  let weekly_reset = "--"

  if (provider === "anthropic") {
    // AC5／AC12：只有 Anthropic 分支讀 Anthropic OAuth Usage API 與 cache；
    // live-first、throttle、stale fallback 都在 collector 內。
    const usage = await collectAnthropicOauthUsage({ env, now_ms, fetch_fn: options.fetch_fn })

    // 若 API 有資料，用 API 的 five_hour 覆蓋 StatusJSON（同 window 不回退）。
    if (usage.five_hour.resets_at !== null) {
      const status_pct = normalizePct(session_pct)
      const api_pct = normalizePct(usage.five_hour.utilization)
      const api_resets_at = isoToEpochSeconds(usage.five_hour.resets_at)
      session_pct = isSameWindowRegression(session_resets_at, api_resets_at, status_pct, api_pct)
        ? status_pct
        : api_pct
      session_resets_at = api_resets_at
    }

    if (usage.seven_day.resets_at !== null) {
      const api_weekly_pct = normalizePct(usage.seven_day.utilization)
      const api_weekly_resets_at = isoToEpochSeconds(usage.seven_day.resets_at)
      weekly_pct = isSameWindowRegression(seven_day.resets_at, api_weekly_resets_at, status_weekly_pct, api_weekly_pct)
        ? status_weekly_pct
        : api_weekly_pct
      weekly_reset = api_weekly_resets_at > 0 ? formatResetClock(api_weekly_resets_at, env.TZ) : "--"
    } else if (seven_day.resets_at > 0 || status_weekly_pct > 0) {
      weekly_pct = status_weekly_pct
      if (seven_day.resets_at > 0) {
        weekly_reset = formatResetClock(seven_day.resets_at, env.TZ)
      }
    }
  }

  session_pct = normalizePct(session_pct)

  // Session reset（AC35）：resets_at 在未來才顯示 30 小時制時刻，否則 --:--。
  const now_seconds = Math.floor(now_ms / 1000)
  let timer_str = "--:--"
  if (session_resets_at > 0 && session_resets_at > now_seconds) {
    timer_str = format30HourResetClock(session_resets_at, env.TZ)
  }

  const bar_rows: StatuslineBarRowView[] = [
    { label: "Context", pct: ctx_pct, scheme: "context", extra: formatTokens(ctx_tokens) },
  ]
  if (provider === "anthropic") {
    bar_rows.push({ label: "Session", pct: session_pct, scheme: "quota", extra: timer_str })
    bar_rows.push({ label: "Weekly", pct: weekly_pct, scheme: "quota", extra: weekly_reset })
  } else if (provider === "openai-codex") {
    // AC11／AC13：GPT 分支絕不碰 Anthropic collector／cache；quota 來源依序為
    // callback rate_limits → fresh store → throttled usage API fetch（ADR-4），
    // rows 依 active windows 動態產生（ADR-3、AC18）。
    const windows = await resolveCodexQuotaWindows(status.rate_limits, env, now_ms, options)
    bar_rows.push(...buildCodexQuotaRows(windows, now_ms, env.TZ))
  } else {
    // Case 11：unknown provider 不碰任何 provider quota 來源——連 Codex store／
    // usage API 也不讀，只顯示單列 unknown Quota。
    bar_rows.push({ label: "Quota", pct: null, scheme: "quota", extra: "--" })
  }

  // Dir 與 git：project_dir（collector 已含 workspace.project_dir → cwd fallback）。
  const project_dir = status.project_dir ?? options.cwd ?? ""
  const dir_name = basename(project_dir) || "~"
  const git_view = await collectGitView(project_dir, options.git_runner ?? defaultGitRunner)

  await logStatuslineInvocation(env, now_ms, {
    model_id,
    project_dir,
    used_pct: session_pct,
    resets_at: session_resets_at,
  })

  return renderStatuslineView({
    // AC1：顯示名稱優先 display_name、缺少時 fallback id（路由與 log 仍只用 id）。
    // formatModel 對 claude-* id 產生短名，對 display_name／非 claude id passthrough，
    // legacy 字串 model（Case 1）因此維持與 bash golden 相同的短名輸出。
    model_short: formatModel(resolveModelDisplayName(status.model) ?? ""),
    effort_level: status.effort_level,
    dir_name,
    bar_rows,
    git: git_view,
  })
}

// ─── Codex quota 分支（spec 36 M3：AC15–AC22、ADR-3/4）─────────────────────────

// 與 Anthropic collector 的 60s throttle 同構（AC16、Case 9）。
const CODEX_FETCH_THROTTLE_SECONDS = 60

const SECONDS_PER_DAY = 86400
const SECONDS_PER_HOUR = 3600

// sub-day（<1 天）window 的 reset 顯示 30 小時制時刻；day+ window 維持倒數（AC35）。
const MINUTES_PER_DAY = 1440

// throttle 時戳不能進 store schema v2（validator 白名單重建會拒），
// 用 store 路徑的 sibling marker 檔案 mtime 記錄上次 fetch attempt。
function codexFetchThrottlePath(env: EnvMap): string {
  return `${resolveCodexUsageFilePath(env)}.fetch-throttle`
}

// Anthropic collector fileAgeSeconds 的同構複本（該 helper 未 export；第三處重複時再抽共用）。
async function fileAgeSeconds(file_path: string, now_ms: number): Promise<number | null> {
  let file_stat
  try {
    file_stat = await stat(file_path)
  } catch {
    return null
  }
  return Math.floor(now_ms / 1000) - Math.floor(file_stat.mtimeMs / 1000)
}

// 寫 marker 後把 mtime 蓋成注入的 now：throttle age 判準完全由注入時鐘決定。
// best-effort（silent fail）：marker 寫不進去只會讓下次 render 再打一次 API，
// 不該讓 render 整條掛掉（使用者裁決：error 跳 silent fail、繼續用 last state）。
async function markCodexFetchAttempt(env: EnvMap, now_ms: number): Promise<void> {
  const marker_path = codexFetchThrottlePath(env)
  try {
    await mkdir(path.dirname(marker_path), { recursive: true })
    await writeFile(marker_path, "")
    const mtime = new Date(now_ms)
    await utimes(marker_path, mtime, mtime)
  } catch {
    // 吞掉：throttle marker 是最佳化，不是 render 的必要條件。
  }
}

// AC15 合成 callback 契約：GPT callback 的 rate_limits schema 對映 Anthropic callback
// 形狀（five_hour/seven_day、used_percentage、resets_at epoch 秒）；window_minutes 由
// key 對映推導，label 仍一律由 window_minutes 推導（AC19）。
const CALLBACK_RATE_LIMIT_WINDOWS: ReadonlyArray<{ key: string; window_minutes: number }> = [
  { key: "five_hour", window_minutes: 300 },
  { key: "seven_day", window_minutes: 10080 },
]

function parseCodexCallbackWindows(rate_limits: Record<string, unknown> | null, now_ms: number): CodexQuotaWindow[] {
  if (rate_limits === null) return []
  const windows: CodexQuotaWindow[] = []
  for (const { key, window_minutes } of CALLBACK_RATE_LIMIT_WINDOWS) {
    const value = rate_limits[key]
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue
    const record = value as Record<string, unknown>
    const resets = record.resets_at
    windows.push({
      // 超界百分比折 null（AC13：不顯示錯誤數字），reset_at 合法性交給 isWindowActive。
      used_percent: isValidUsedPercent(record.used_percentage) ? record.used_percentage : null,
      reset_at: typeof resets === "number" && Number.isFinite(resets) && resets > 0 ? resets : null,
      window_minutes,
    })
  }
  return windows.filter((window) => isWindowActive(window, now_ms))
}

interface CodexWindowPair {
  primary: CodexQuotaWindow | null
  secondary: CodexQuotaWindow | null
}

// primary／secondary 只是來源 ordinal（Case 5）；只有 active window 產生 row（AC18）。
function activeSnapshotWindows(snapshot: CodexWindowPair, now_ms: number): CodexQuotaWindow[] {
  return [snapshot.primary, snapshot.secondary].filter((window): window is CodexQuotaWindow =>
    isWindowActive(window, now_ms),
  )
}

// GPT quota 資料流（ADR-4，與 Anthropic 分支同構）：
// callback rate_limits（合法即最優先，AC15）→ throttled usage API fetch（AC16/AC17）→
// fresh store fallback → 全部不可用回空（誠實 unknown，Case 10）。
async function resolveCodexQuotaWindows(
  rate_limits: Record<string, unknown> | null,
  env: EnvMap,
  now_ms: number,
  options: StatuslineRenderOptions,
): Promise<CodexQuotaWindow[]> {
  const callback_windows = parseCodexCallbackWindows(rate_limits, now_ms)
  if (callback_windows.length > 0) return callback_windows

  // Store 先讀取但只作 fallback；不得因 store 尚在 freshness 內就跳過 live fetch，
  // 否則其他 harness 的舊 observation 會在 CCX 畫面沿用最長 60 分鐘。
  const fresh = await readCodexUsageFresh({ env, now_ms })

  // throttle 內不重打，沿用 fresh store；沒有合法 fallback 才顯示 unknown（Case 9/10）。
  const throttle_age = await fileAgeSeconds(codexFetchThrottlePath(env), now_ms)
  if (throttle_age !== null && throttle_age < CODEX_FETCH_THROTTLE_SECONDS) {
    return fresh !== null ? activeSnapshotWindows(fresh, now_ms) : []
  }

  // 先標記再 fetch：fetch 失敗也不在同 throttle 週期內重打（Anthropic collector parity）。
  await markCodexFetchAttempt(env, now_ms)
  const result = await fetchCodexUsage({
    fetch_fn: options.codex_fetch_fn,
    auth_file_path: options.codex_auth_file_path,
    now_ms,
  })
  if (result.ok) {
    // 資料已在 result.observation 手上：先算回傳，store 寫入是 best-effort（silent fail）。
    // lock 逾時／ENOSPC／目錄不可建等寫入失敗不該讓剛 fetch 到的 quota 無法顯示
    // （AC16、使用者裁決：繼續用 last state；此處 last state 即本次 fetch 結果）。
    try {
      await writeCodexUsageSnapshot(result.observation, { env, now_ms })
    } catch {
      // 吞掉：寫入 shared store 失敗不影響本次 render。
    }
    return activeSnapshotWindows(result.observation, now_ms)
  }

  // fetch 失敗：重新讀取 freshness 內 store，納入 fetch 期間並行 writer 的更新；否則 unknown。
  const fallback = await readCodexUsageFresh({ env, now_ms })
  return fallback !== null ? activeSnapshotWindows(fallback, now_ms) : []
}

// day+ window 的倒數：≥1 天顯示 Nd Nh（Weekly「6d 4h」），否則 Nh Nm。
function formatCodexCountdown(remaining_seconds: number): string {
  if (remaining_seconds >= SECONDS_PER_DAY) {
    const days = Math.floor(remaining_seconds / SECONDS_PER_DAY)
    const hours = Math.floor((remaining_seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR)
    return `${days}d ${hours}h`
  }
  const hours = Math.floor(remaining_seconds / SECONDS_PER_HOUR)
  const minutes = Math.floor((remaining_seconds % SECONDS_PER_HOUR) / 60)
  return `${hours}h ${minutes}m`
}

// sub-day（<1 天）window：window_minutes 為有限正數且 < MINUTES_PER_DAY（Codex 300、
// 或其他小時級窗）；null／day+ 視為非 sub-day，走倒數。
function isSubDayWindow(window_minutes: number | null): boolean {
  return typeof window_minutes === "number" && Number.isFinite(window_minutes) && window_minutes > 0 && window_minutes < MINUTES_PER_DAY
}

// window reset 顯示（AC35）：sub-day → 30 小時制時刻；day+ → 倒數。
function formatCodexWindowReset(window: CodexQuotaWindow, now_seconds: number, time_zone: string | undefined): string {
  const reset_at = window.reset_at as number // isWindowActive 已保證合法且未過期。
  if (isSubDayWindow(window.window_minutes)) {
    return format30HourResetClock(reset_at, time_zone)
  }
  return formatCodexCountdown(reset_at - now_seconds)
}

// rows 依 active windows 動態產生（ADR-3）：label 由 window_minutes 推導（AC19），
// 依 window 長度排序（短窗在前，Session→Weekly；ordinal 不可信，Case 5）；
// 缺 used_percent 顯示 --%（AC22、Case 7）；無 active window 單列 unknown（AC18）。
function buildCodexQuotaRows(windows: CodexQuotaWindow[], now_ms: number, time_zone: string | undefined): StatuslineBarRowView[] {
  if (windows.length === 0) {
    return [{ label: "Quota", pct: null, scheme: "quota", extra: "--" }]
  }
  const now_seconds = Math.floor(now_ms / 1000)
  const sorted = [...windows].sort(
    (a, b) => (a.window_minutes ?? Number.MAX_SAFE_INTEGER) - (b.window_minutes ?? Number.MAX_SAFE_INTEGER),
  )
  return sorted.map((window) => ({
    label: windowLabel(window.window_minutes, STATUSLINE_WINDOW_LABEL_OVERRIDES) ?? "Quota",
    pct: window.used_percent === null ? null : normalizePct(window.used_percent),
    scheme: "quota" as const,
    extra: formatCodexWindowReset(window, now_seconds, time_zone),
  }))
}

// ─── 資料計算 helpers ────────────────────────────────────────────────────────

// bash jq ctx_tokens parity：current_usage object → input＋cache_creation＋cache_read
// （不含 output）；legacy number → 原值；缺少 → total_input＋total_output。
function computeContextTokens(context_window: StatusJsonContextWindow | null): number {
  if (context_window === null) return 0
  const { current_usage } = context_window
  if (typeof current_usage === "number") return current_usage
  if (current_usage !== null) {
    return (
      (current_usage.input_tokens ?? 0) +
      (current_usage.cache_creation_input_tokens ?? 0) +
      (current_usage.cache_read_input_tokens ?? 0)
    )
  }
  return (context_window.total_input_tokens ?? 0) + (context_window.total_output_tokens ?? 0)
}

// ─── Context carry-forward（v5 AC33、Case 12）────────────────────────────────

// per-session context store 預設路徑；env override 供測試隔離（見 spec Store contract）。
const DEFAULT_CONTEXT_CACHE_DIR = "/tmp/claude/statusline-context"

function resolveContextCacheDir(env: EnvMap): string {
  const value = env.STATUSLINE_CONTEXT_CACHE_DIR
  return value === undefined || value === "" ? DEFAULT_CONTEXT_CACHE_DIR : value
}

// 每個 session 一檔；把路徑分隔字元換掉，避免 session_id 逃逸出 cache 目錄。
function contextCacheFilePath(env: EnvMap, session_id: string): string {
  const safe_name = session_id.replaceAll("/", "_").replaceAll("\\", "_")
  return path.join(resolveContextCacheDir(env), `${safe_name}.json`)
}

// best-effort：讀不到／parse 失敗／非正數一律回 null（視為無可沿用記錄）。
async function readCachedContextTokens(file_path: string): Promise<number | null> {
  try {
    const parsed = JSON.parse(await readFile(file_path, "utf8")) as { tokens?: unknown }
    const tokens = parsed.tokens
    return typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0 ? tokens : null
  } catch {
    return null
  }
}

// best-effort（silent fail）：cache 是暫態遮蔽最佳化，寫不進去只會讓下次歸零 render 顯示 0。
async function writeCachedContextTokens(file_path: string, tokens: number): Promise<void> {
  try {
    await mkdir(path.dirname(file_path), { recursive: true })
    await writeFile(file_path, JSON.stringify({ tokens }))
  } catch {
    // 吞掉：與 log／throttle marker 相同紀律。
  }
}

// tokens 非零 → 更新 cache 並回傳；tokens 為 0 → 有 cache 沿用上次值（＝工具執行中閃動）、
// 無 cache 顯示 0（＝session 剛開始）。缺 session_id 時不啟用，回傳原值（golden 不受影響）。
async function resolveContextTokens(raw_tokens: number, session_id: string | null, env: EnvMap): Promise<number> {
  if (session_id === null || session_id === "") return raw_tokens
  const file_path = contextCacheFilePath(env, session_id)
  if (raw_tokens > 0) {
    await writeCachedContextTokens(file_path, raw_tokens)
    return raw_tokens
  }
  return (await readCachedContextTokens(file_path)) ?? raw_tokens
}

interface RateLimitWindow {
  used_pct: number
  resets_at: number
}

// bash jq safe_num parity：缺欄位／null／非 number → 0；used_percentage 先 round。
function readRateLimitWindow(rate_limits: Record<string, unknown> | null, key: string): RateLimitWindow {
  const window = rate_limits?.[key]
  const record =
    typeof window === "object" && window !== null && !Array.isArray(window)
      ? (window as Record<string, unknown>)
      : null
  const used = record?.used_percentage
  const resets = record?.resets_at
  return {
    used_pct: Math.round(typeof used === "number" && Number.isFinite(used) ? used : 0),
    resets_at: typeof resets === "number" && Number.isFinite(resets) ? resets : 0,
  }
}

// bash date -d <ISO> +%s parity：解析失敗回 0（呼叫端以 0 視為無效）。
function isoToEpochSeconds(value: string): number {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

// 同一個 reset window（差 ≤60s）內，較低的 API/cache 值通常是 stale cache，
// 不讓用量倒退（AC5）；不同 window 一律採 API 值。
function isSameWindowRegression(
  status_resets_at: number,
  api_resets_at: number,
  status_pct: number,
  api_pct: number,
): boolean {
  if (status_resets_at <= 0 || api_resets_at <= 0) return false
  return Math.abs(api_resets_at - status_resets_at) <= 60 && api_pct < status_pct
}

// reset 本體設計在整分邊界上，來源回報帶 sub-minute 抖動（API ISO 帶小數秒、跨 fetch 落在
// 整秒邊界兩側）；Intl 只取 hour/minute 等於截斷秒，會讓 23:59:45 顯示 23:59、00:00:15 顯示
// 00:00，同一 reset 在兩視窗閃成不同分鐘。統一 round 到最近分後兩側都收斂到同一分鐘。
function roundEpochToMinute(epoch_seconds: number): number {
  return Math.round(epoch_seconds / 60) * 60
}

// 30 小時制 reset 時刻（AC35）：以本地時刻計，hour < 6 顯示為 hour+24（24–29），
// 否則原值；即 05:59 之後接 06:00。時區取 env.TZ（未設定用系統時區）。
// 解析失敗回 --:--（呼叫端只在 reset 合法且未過期時呼叫）。
function format30HourResetClock(epoch_seconds: number, time_zone: string | undefined): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: time_zone === undefined || time_zone === "" ? undefined : time_zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(roundEpochToMinute(epoch_seconds) * 1000))
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((candidate) => candidate.type === type)?.value ?? ""
    const minute = part("minute")
    let hour = Number.parseInt(part("hour"), 10)
    if (!Number.isFinite(hour) || minute === "") return "--:--"
    if (hour < 6) hour += 24
    return `${String(hour).padStart(2, "0")}:${minute}`
  } catch {
    return "--:--"
  }
}

// bash date "+%a %H:%M" parity：C locale 縮寫星期＋24 小時制；時區取 env.TZ
// （未設定時用系統時區，同 bash date 行為）。
function formatResetClock(epoch_seconds: number, time_zone: string | undefined): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: time_zone === undefined || time_zone === "" ? undefined : time_zone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(roundEpochToMinute(epoch_seconds) * 1000))
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((candidate) => candidate.type === type)?.value ?? ""
    return `${part("weekday")} ${part("hour")}:${part("minute")}`
  } catch {
    return "--"
  }
}

// ─── Dir／git ────────────────────────────────────────────────────────────────

// bash ${cwd##*/} parity：取最後一段路徑；無 / 時回原字串。
function basename(dir_path: string): string {
  return dir_path.slice(dir_path.lastIndexOf("/") + 1)
}

const defaultGitRunner: GitRunner = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })

function tryGit(run_git: GitRunner, args: string[]): string {
  try {
    // bash $(...) parity：去掉結尾換行。
    return run_git(args).replace(/\n+$/, "")
  } catch {
    return ""
  }
}

async function collectGitView(project_dir: string, run_git: GitRunner): Promise<StatuslineGitView | null> {
  if (project_dir === "" || !(await isDirectory(project_dir))) return null

  const branch = tryGit(run_git, ["-C", project_dir, "branch", "--show-current"])
  const shortstat = tryGit(run_git, ["-C", project_dir, "diff", "--shortstat"])
  // untracked：ls-files --others --exclude-standard 尊重 .gitignore，一行一檔。
  const untracked_out = tryGit(run_git, ["-C", project_dir, "ls-files", "--others", "--exclude-standard"])
  if (branch === "") return null

  return {
    branch,
    insertions: parseShortstatCount(shortstat, /(\d+) insertion/),
    deletions: parseShortstatCount(shortstat, /(\d+) deletion/),
    untracked: countLines(untracked_out),
  }
}

// tryGit 已去尾換行；空字串代表 0 檔，非空則行數即檔數。
function countLines(text: string): number {
  return text === "" ? 0 : text.split("\n").length
}

async function isDirectory(dir_path: string): Promise<boolean> {
  try {
    return (await stat(dir_path)).isDirectory()
  } catch {
    return false
  }
}

function parseShortstatCount(shortstat: string, pattern: RegExp): number {
  const matched = shortstat.match(pattern)
  return matched === null ? 0 : Number.parseInt(matched[1], 10)
}

// ─── Logging（既有可觀察行為，research 蒐證依賴；bash 299–341 行 parity）────────

// bash `: "${VAR:=default}"` 語意：unset 或空字串都補預設；"0" 停用。
function resolveInvocationLogPath(env: EnvMap): string | null {
  const value = env.STATUSLINE_INVOCATION_LOG
  const resolved = value === undefined || value === "" ? DEFAULT_INVOCATION_LOG_PATH : value
  return resolved === "0" ? null : resolved
}

// bash 只在「未設定」（${VAR+x}）時補預設：空字串與 "0" 都停用。
function resolveInputLogPath(env: EnvMap): string | null {
  const value = env.STATUSLINE_INPUT_LOG
  if (value === undefined) return DEFAULT_INPUT_LOG_PATH
  return value === "" || value === "0" ? null : value
}

// logging 是 best-effort：任何失敗不影響 render（bash 2>/dev/null || true parity）。
async function appendLogLine(log_path: string, line: string): Promise<void> {
  try {
    await mkdir(path.dirname(log_path), { recursive: true })
    await appendFile(log_path, line)
  } catch {
    // 吞掉：log 寫不進去不是 render 失敗的理由。
  }
}

async function logStatuslineInput(input: string, env: EnvMap, now_ms: number): Promise<void> {
  const log_path = resolveInputLogPath(env)
  if (log_path === null) return

  // jq --argjson parity：payload 不是合法 JSON 時整條不寫。
  let payload: unknown
  try {
    payload = JSON.parse(input)
  } catch {
    return
  }
  await appendLogLine(log_path, `${JSON.stringify({ ts: formatIsoWithOffset(now_ms), payload })}\n`)
}

interface InvocationLogFields {
  model_id: string
  project_dir: string
  used_pct: number
  resets_at: number
}

async function logStatuslineInvocation(env: EnvMap, now_ms: number, fields: InvocationLogFields): Promise<void> {
  const log_path = resolveInvocationLogPath(env)
  if (log_path === null) return

  // tab 分隔格式：欄位值裡的 tab／換行替換為空格，避免破壞一行一筆。
  const sanitize = (value: string): string => value.replaceAll("\t", " ").replaceAll("\n", " ")
  const line = [
    formatIsoWithOffset(now_ms),
    `pid=${process.pid}`,
    `ppid=${process.ppid}`,
    "mode=full",
    "cols=",
    `model=${sanitize(fields.model_id)}`,
    `project=${sanitize(fields.project_dir)}`,
    `usage=${fields.used_pct}`,
    `reset_at=${fields.resets_at}`,
  ].join("\t")
  await appendLogLine(log_path, `${line}\n`)
}

// bash date -Is parity：秒級 ISO 8601＋UTC offset；時區採 process 時區
// （log timestamp 僅供蒐證，不參與 golden 比對）。
function formatIsoWithOffset(now_ms: number): string {
  const date = new Date(now_ms)
  const pad = (value: number): string => String(value).padStart(2, "0")
  const offset_minutes = -date.getTimezoneOffset()
  const sign = offset_minutes >= 0 ? "+" : "-"
  const abs_offset = Math.abs(offset_minutes)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs_offset / 60))}:${pad(abs_offset % 60)}`
  )
}
