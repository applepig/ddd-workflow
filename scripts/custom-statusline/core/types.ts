// harness／provider 分離的 contract：Claude Code 只是 harness，
// provider 由 model id 正規化（spec 36 ADR-1），不以 quota 欄位或 display name 推測。
export type ProviderKind = "anthropic" | "openai-codex" | "unknown"

// 共用 Codex store 的寫入來源（spec 36 store contract）。
export type CodexUsageSource = "codex-usage-api" | "opencode-capture"

// 單一 quota window。缺欄位語意是 null 而不是 0（AC26）：
// used_percent 為 null 時顯示層以 --% 呈現（Case 7），不得當 0%。
// reset_at 使用 Unix epoch 秒；elapsed 判準見 core/quota-window.ts。
export interface CodexQuotaWindow {
  used_percent: number | null
  reset_at: number | null
  window_minutes: number | null
}

export interface CodexCredits {
  has_credits: boolean | null
  unlimited: boolean | null
}

// 共用 Codex usage store 的 snapshot schema v2。
// observed_at（觀測時間）與 updated_at（寫入時間）分離；
// freshness 與競寫 guard 一律以 observed_at 計（AC23、AC25）。
// 兩者皆為 ISO 8601 UTC 字串。
export interface CodexUsageSnapshot {
  schema_version: 2
  provider: "openai"
  source: CodexUsageSource
  observed_at: string
  updated_at: string
  plan_type: string | null
  active_limit: string | null
  credits: CodexCredits | null
  // primary／secondary 只是來源 ordinal（Case 5）；window 本身可為 null（如實測 secondary_window 為 null）。
  primary: CodexQuotaWindow | null
  secondary: CodexQuotaWindow | null
}
