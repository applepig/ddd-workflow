// OpenCode TUI 的欄位排版（spec 36 ADR-7：排版不共用，留在本檔）。
// window／elapsed／freshness 判準一律 import core/quota-window——OpenCode 不再自帶判準副本；
// label 用字（5hr/week/2wk）沿用 core 的 OPENCODE label mapping（AC19）。
import {
  OPENCODE_WINDOW_LABEL_OVERRIDES,
  isObservationFresh,
  isValidUsedPercent,
  isWindowElapsed,
  windowLabel as deriveWindowLabel,
} from "../custom-statusline/core/quota-window.ts"
import { resolveMaxAgeSeconds } from "../custom-statusline/core/codex-usage-store.ts"

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

export function activeLimitRows(usage) {
  const active = [usage?.primary, usage?.secondary].filter((slot) => slot?.reset_at)
  if (active.length === 0) return [{ label: "wk", limit: undefined }]
  return active.map((slot) => ({ label: windowLabel(slot.window_minutes) ?? "wk", limit: slot }))
}

// stale→unknown（AC24）：observed_at 超過 freshness 的 snapshot，percent 一律 unknown；
// 缺 used_percent 是 null 不是 0（Case 7 同族判準），同樣以 unknown 呈現。
// observed_at 未提供時跳過 freshness gate（單 window 層級的呼叫；snapshot 層一律傳入）。
export function usedPercent(limit, now, observed_at, max_age_seconds = resolveMaxAgeSeconds()) {
  if (!limit) return undefined
  if (observed_at !== undefined && !isObservationFresh(observed_at, now, max_age_seconds)) return undefined
  if (limit.reset_at && isWindowElapsed(limit.reset_at, now)) return undefined
  if (!isValidUsedPercent(limit.used_percent)) return undefined
  return Math.round(limit.used_percent)
}

export function limitColumns(label, limit, now, observed_at, max_age_seconds = resolveMaxAgeSeconds()) {
  const percent_value = usedPercent(limit, now, observed_at, max_age_seconds)

  return {
    label: (windowLabel(limit?.window_minutes) ?? label).padStart(4),
    percent: (percent_value === undefined ? "--%" : `${percent_value}%`).padStart(4),
    percent_value,
    reset: formatRemaining(limit?.reset_at, now).padStart(5),
  }
}
