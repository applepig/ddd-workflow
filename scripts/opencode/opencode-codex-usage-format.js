// OpenCode TUI 的欄位排版（spec 36 ADR-7：排版不共用，留在本檔）。
// window／elapsed／freshness 判準一律 import core/quota-window——OpenCode 不再自帶判準副本；
// label 用字（5hr/week/2wk）沿用 core 的 OPENCODE label mapping（AC19）。
import {
  OPENCODE_WINDOW_LABEL_OVERRIDES,
  isObservationFresh,
  isObservedAtPlausible,
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
