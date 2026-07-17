// x-codex-* quota headers → schema v2 observation（spec 36 AC26）。
// 修正舊 capture 的兩個 bug：missing 欄位默認 0（?? 0）與寫死 label——
// 本模組 missing 一律序列化為 null，且根本不輸出 label（label 由 core/quota-window 從 window_minutes 推導）。
import type { CodexUsageObservation } from "../core/codex-usage-store.ts"
import type { CodexCredits, CodexQuotaWindow } from "../core/types.ts"
import { isValidUsedPercent } from "../core/quota-window.ts"

// 輸入契約是 header getter（AC26）：OpenCode 的 Headers 物件與測試 POJO 各自在呼叫端 adapt，
// 本模組只吃 getter，不耦合任何 Headers 實作。
export type HeaderGetter = (name: string) => string | null

// x-codex-* allowlist（research.md 實測清單；spec 36 非目標：store 只保存 quota allowlist）。
// 其中 reset-after-seconds 與 over-secondary-limit-percent 在 schema v2 沒有對應欄位，
// 屬「觀測到但不序列化」——reset_at 才是 canonical reset 訊號。
export const CODEX_QUOTA_HEADER_ALLOWLIST: readonly string[] = [
  "x-codex-primary-used-percent",
  "x-codex-primary-reset-at",
  "x-codex-primary-reset-after-seconds",
  "x-codex-primary-window-minutes",
  "x-codex-primary-over-secondary-limit-percent",
  "x-codex-secondary-used-percent",
  "x-codex-secondary-reset-at",
  "x-codex-secondary-reset-after-seconds",
  "x-codex-secondary-window-minutes",
  "x-codex-plan-type",
  "x-codex-active-limit",
  "x-codex-credits-has-credits",
  "x-codex-credits-unlimited",
]

function stringHeader(get_header: HeaderGetter, name: string): string | null {
  const raw = get_header(name)
  if (raw === null) return null
  const trimmed = raw.trim()
  return trimmed === "" ? null : trimmed
}

// Number("") 是 0，所以先走 stringHeader 把空值正規化為 null，避免空 header 變成合法數字。
function numberHeader(get_header: HeaderGetter, name: string): number | null {
  const value = stringHeader(get_header, name)
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

// reset_at（epoch 秒）與 window_minutes 的合法值必為正數：實機觀察到未開啟的 window 會送 "0"
// （reset_at=0、window_minutes=0），0 不是合法 window 訊號。此處折 null，對齊 usage-api collector 的
// isPositiveFiniteNumber 判準；否則 store validator 對 <=0 整份拒收，導致整筆 observation 被靜默丟棄。
function positiveNumberHeader(get_header: HeaderGetter, name: string): number | null {
  const parsed = numberHeader(get_header, name)
  return parsed !== null && parsed > 0 ? parsed : null
}

function percentHeader(get_header: HeaderGetter, name: string): number | null {
  const parsed = numberHeader(get_header, name)
  return isValidUsedPercent(parsed) ? parsed : null
}

// 只認 true/false（大小寫不拘）；其他值視為 missing——舊 capture 把垃圾值折成 false，與 ?? 0 同族。
function booleanHeader(get_header: HeaderGetter, name: string): boolean | null {
  const value = stringHeader(get_header, name)
  if (value === null) return null
  const lowered = value.toLowerCase()
  if (lowered === "true") return true
  if (lowered === "false") return false
  return null
}

function quotaWindow(get_header: HeaderGetter, ordinal: "primary" | "secondary"): CodexQuotaWindow | null {
  const window: CodexQuotaWindow = {
    used_percent: percentHeader(get_header, `x-codex-${ordinal}-used-percent`),
    reset_at: positiveNumberHeader(get_header, `x-codex-${ordinal}-reset-at`),
    window_minutes: positiveNumberHeader(get_header, `x-codex-${ordinal}-window-minutes`),
  }
  const has_data = window.used_percent !== null || window.reset_at !== null || window.window_minutes !== null
  return has_data ? window : null
}

function credits(get_header: HeaderGetter): CodexCredits | null {
  const parsed: CodexCredits = {
    has_credits: booleanHeader(get_header, "x-codex-credits-has-credits"),
    unlimited: booleanHeader(get_header, "x-codex-credits-unlimited"),
  }
  const has_data = parsed.has_credits !== null || parsed.unlimited !== null
  return has_data ? parsed : null
}

// observed_at 由呼叫端注入（capture 當下時間），本模組不呼叫 Date.now()；
// updated_at 由 store 寫入時蓋章（AC23 observed/updated 分離），所以輸出是 CodexUsageObservation。
export function collectCodexQuotaHeaders(
  get_header: HeaderGetter,
  observed_at: string,
): CodexUsageObservation | null {
  const observation: CodexUsageObservation = {
    schema_version: 2,
    provider: "openai",
    source: "opencode-capture",
    observed_at,
    plan_type: stringHeader(get_header, "x-codex-plan-type"),
    active_limit: stringHeader(get_header, "x-codex-active-limit"),
    credits: credits(get_header),
    primary: quotaWindow(get_header, "primary"),
    secondary: quotaWindow(get_header, "secondary"),
  }

  const has_quota_data =
    observation.plan_type !== null ||
    observation.active_limit !== null ||
    observation.credits !== null ||
    observation.primary !== null ||
    observation.secondary !== null

  // 全缺（含 getter 全回 null）代表這個 response 沒有可序列化的 quota 資料，
  // 誠實回 null，讓呼叫端不寫 store，而不是造出全 null 的 snapshot。
  return has_quota_data ? observation : null
}
