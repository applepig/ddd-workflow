// OpenCode TUI 的欄位排版（spec 36 ADR-7：排版不共用，留在本檔）。
// window／elapsed／freshness 判準一律 import core/quota-window——OpenCode 不再自帶判準副本；
// label 用字（5hr/week/2wk）沿用 core 的 OPENCODE label mapping（AC19）。
import {
  OPENCODE_WINDOW_LABEL_OVERRIDES,
  isObservationFresh,
  isObservedAtPlausible,
  isValidUsedPercent,
  isWindowActive,
  isWindowElapsed,
  windowLabel as deriveWindowLabel,
} from "../custom-statusline/core/quota-window.ts"
import { readCodexUsageRaw, resolveMaxAgeSeconds } from "../custom-statusline/core/codex-usage-store.ts"

export function formatRemaining(reset_at, now) {
  if (!reset_at) return "--:--"

  const remaining = Math.floor(reset_at - now / 1000)
  if (remaining <= 0) return "--:--"
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)

  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${minutes}m`
  return `${minutes}m`
}

function windowLabel(window_minutes) {
  return deriveWindowLabel(window_minutes, OPENCODE_WINDOW_LABEL_OVERRIDES) ?? undefined
}

// openai reader：codex snapshot → 正規化 usage（observed_at＋rows）。snapshot 是一次完整觀測，
// 缺的 window 就是沒有，不從別處補（spec 50 ADR-2）。
function openaiUsage(snapshot) {
  if (!snapshot) return undefined
  return {
    observed_at: snapshot.observed_at,
    rows: [snapshot.primary, snapshot.secondary].filter(Boolean).map((window) => ({
      label: windowLabel(window.window_minutes) ?? "wk",
      used_percent: window.used_percent,
      reset_at: window.reset_at,
    })),
  }
}

// spec 50 ADR-3：providerID → reader。新 provider＝capture hook＋自己的 store 檔＋這裡一行，
// 不擴充 codex store schema。沒註冊的 provider 一律沒有 usage，不跨 provider fallback。
const USAGE_READERS = new Map([
  ["openai", async (options) => openaiUsage(await readCodexUsageRaw(options))],
])

export async function readProviderUsage(providerID, options) {
  const reader = USAGE_READERS.get(providerID)
  return reader ? reader(options) : undefined
}

// 只留 active window（reset_at 合法且未過）；沒有就回空陣列，由 TUI 決定整個不 render。
export function activeLimitRows(usage, now) {
  return (usage?.rows ?? []).filter((row) => isWindowActive(row, now))
}

// freshness 以外的有效值判準共用於 public unknown 判斷與 TUI stale display fallback。
function validLimitPercent(limit, now) {
  if (!limit) return undefined
  if (limit.reset_at && isWindowElapsed(limit.reset_at, now)) return undefined
  if (!isValidUsedPercent(limit.used_percent)) return undefined
  return Math.round(limit.used_percent)
}

// 保留 public contract：stale／invalid observation 不能作為有效 quota 判斷。
export function usedPercent(limit, now, observed_at, max_age_seconds = resolveMaxAgeSeconds()) {
  if (observed_at !== undefined && !isObservationFresh(observed_at, now, max_age_seconds)) return undefined
  return validLimitPercent(limit, now)
}

// AC24 v7 僅允許 structurally valid、超過 freshness 的 local snapshot 作 TUI muted fallback。
function hasStaleObservation(observed_at, now, max_age_seconds) {
  return (
    observed_at !== undefined &&
    isObservedAtPlausible(observed_at, now) &&
    !isObservationFresh(observed_at, now, max_age_seconds)
  )
}

export function limitColumns(label, limit, now, observed_at, max_age_seconds = resolveMaxAgeSeconds()) {
  const fresh_percent = usedPercent(limit, now, observed_at, max_age_seconds)
  const stale_percent =
    fresh_percent === undefined && hasStaleObservation(observed_at, now, max_age_seconds)
      ? validLimitPercent(limit, now)
      : undefined
  const percent_value = stale_percent ?? fresh_percent

  return {
    label: (windowLabel(limit?.window_minutes) ?? label).padStart(4),
    percent: (percent_value === undefined ? "--%" : `${percent_value}%`).padStart(4),
    percent_value,
    ...(stale_percent !== undefined ? { percent_is_stale: true } : {}),
    reset: formatRemaining(limit?.reset_at, now).padStart(5),
  }
}
