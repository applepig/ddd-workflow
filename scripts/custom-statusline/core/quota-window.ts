import type { CodexQuotaWindow } from "./types.ts"

export interface WindowKind {
  unit: "week" | "day" | "hour" | "minute"
  count: number
}

// label 一律由 window_minutes 推導（AC19、Case 5），不信任來源寫死的 label 欄位。
// 判準共用、用字由呼叫端選：statusline 用 Session/Weekly，OpenCode 用通用推導（5hr/week）。
export const STATUSLINE_WINDOW_LABEL_OVERRIDES: Readonly<Record<number, string>> = {
  300: "Session",
  10080: "Weekly",
}

export const OPENCODE_WINDOW_LABEL_OVERRIDES: Readonly<Record<number, string>> = {}

const MINUTES_PER_WEEK = 10080
const MINUTES_PER_DAY = 1440
const MINUTES_PER_HOUR = 60

export function resolveWindowKind(window_minutes: number | null | undefined): WindowKind | null {
  if (typeof window_minutes !== "number" || !Number.isFinite(window_minutes) || window_minutes <= 0) {
    return null
  }
  if (window_minutes % MINUTES_PER_WEEK === 0) return { unit: "week", count: window_minutes / MINUTES_PER_WEEK }
  if (window_minutes % MINUTES_PER_DAY === 0) return { unit: "day", count: window_minutes / MINUTES_PER_DAY }
  if (window_minutes % MINUTES_PER_HOUR === 0) return { unit: "hour", count: window_minutes / MINUTES_PER_HOUR }
  return { unit: "minute", count: window_minutes }
}

// 通用推導用字與既有 opencode windowLabel() 判準一致：week/Nwk、Nd、Nhr、Nm。
function genericWindowLabel(kind: WindowKind): string {
  switch (kind.unit) {
    case "week":
      return kind.count === 1 ? "week" : `${kind.count}wk`
    case "day":
      return `${kind.count}d`
    case "hour":
      return `${kind.count}hr`
    case "minute":
      return `${kind.count}m`
  }
}

export function windowLabel(
  window_minutes: number | null | undefined,
  overrides: Readonly<Record<number, string>> = {},
): string | null {
  const kind = resolveWindowKind(window_minutes)
  if (kind === null) return null
  const override = overrides[window_minutes as number]
  return override ?? genericWindowLabel(kind)
}

function isValidResetAt(reset_at: unknown): reset_at is number {
  return typeof reset_at === "number" && Number.isFinite(reset_at) && reset_at > 0
}

// reset_at 是 epoch 秒；store contract 明文以秒比較，不得拿毫秒直接比。
export function isWindowElapsed(reset_at: number, now_ms: number): boolean {
  return reset_at <= Math.floor(now_ms / 1000)
}

// active 判準只看 reset_at（AC18）：缺 used_percent 但 reset_at 合法仍是 active（Case 7），
// percent 缺值如何呈現是顯示層的責任。
export function isWindowActive(window: CodexQuotaWindow | null | undefined, now_ms: number): boolean {
  if (!window) return false
  if (!isValidResetAt(window.reset_at)) return false
  return !isWindowElapsed(window.reset_at, now_ms)
}

// 時鐘偏移容忍（spec 未明定，推導值）：吸收跨機器的小幅時鐘超前，
// 同時遠小於 max_age（3600s），不影響 freshness 語意。
export const OBSERVED_AT_FUTURE_TOLERANCE_SECONDS = 300

// 超前 now 超過容忍值的 observed_at 是時鐘錯亂產物：若不設下限，負 age 恆過
// freshness 上限、且 observed_at guard 恆贏，一筆未來 snapshot 會永久毒化 store（AC23）。
export function isObservedAtPlausible(observed_at: unknown, now_ms: number): boolean {
  if (typeof observed_at !== "string") return false
  const observed_ms = Date.parse(observed_at)
  if (!Number.isFinite(observed_ms)) return false
  return observed_ms - now_ms <= OBSERVED_AT_FUTURE_TOLERANCE_SECONDS * 1000
}

// freshness 只以 observed_at 計（AC23）；parse 不出時間的 snapshot 一律視為 stale，
// 誠實顯示 unknown 而不是沿用舊數字（AC24）。max age 由呼叫端決定（預設與 env override 屬 store 層）。
export function isObservationFresh(observed_at: unknown, now_ms: number, max_age_seconds: number): boolean {
  if (!isObservedAtPlausible(observed_at, now_ms)) return false
  return now_ms - Date.parse(observed_at as string) <= max_age_seconds * 1000
}

export function isValidUsedPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
}
