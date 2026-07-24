// Codex usage API collector（spec 36 AC16 fetch/正規化、AC17）：
// GET /wham/usage → schema v2 observation。純 fetch+normalize，throttle 由呼叫端配 store 處理。
// 失敗一律回明確 reason（Case 8）：不重試、不 refresh token、不寫 auth.json、不洩漏 token 內容。
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type { CodexUsageObservation } from "../core/codex-usage-store.ts"
import type { CodexCredits, CodexQuotaWindow } from "../core/types.ts"
import { isValidUsedPercent } from "../core/quota-window.ts"

// codex CLI 原始碼的 /api/codex/usage 對外部 client 會被 Cloudflare 403 擋，
// 實測可用路徑是 backend-api（2026-07-17 勘誤，見 spec 36 文首）。
export const CODEX_USAGE_BASE_URL = "https://chatgpt.com/backend-api"

// 與既有 statusline.sh fetchUsageAPI 的 curl --max-time 5 對齊。
export const DEFAULT_TIMEOUT_MS = 5000

export type CodexUsageFetchFailureReason =
  | "auth_unavailable"
  | "auth_malformed"
  | "auth_incomplete"
  | "unauthorized"
  | "http_error"
  | "network_error"
  | "invalid_response"

export type CodexUsageFetchResult =
  | { ok: true; observation: CodexUsageObservation }
  | { ok: false; reason: CodexUsageFetchFailureReason }

// 結構性最小 fetch 契約：測試注入 fake、runtime 用 globalThis.fetch，
// 不耦合 DOM lib 的完整 Response 型別。
export interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface FetchRequestInit {
  method: string
  headers: Record<string, string>
  signal: AbortSignal
}

export type FetchLike = (url: string, init: FetchRequestInit) => Promise<FetchResponseLike>

export interface CodexUsageApiOptions {
  fetch_fn?: FetchLike
  auth_file_path?: string
  base_url?: string
  now_ms?: number
  timeout_ms?: number
}

export function resolveCodexAuthFilePath(): string {
  return path.join(homedir(), ".codex", "auth.json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

type CodexAuth =
  | { ok: true; access_token: string; account_id: string }
  | { ok: false; reason: "auth_unavailable" | "auth_malformed" | "auth_incomplete" }

// AC17：credential 只從 auth.json 讀，任何缺損都是明確失敗，不嘗試 refresh。
// reason 一律是常數字串，錯誤路徑不攜帶 token 內容。
async function readCodexAuth(auth_file_path: string): Promise<CodexAuth> {
  let raw: string
  try {
    raw = await readFile(auth_file_path, "utf8")
  } catch {
    return { ok: false, reason: "auth_unavailable" }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: "auth_malformed" }
  }

  if (!isRecord(parsed) || !isRecord(parsed.tokens)) return { ok: false, reason: "auth_incomplete" }
  const { access_token, account_id } = parsed.tokens
  if (typeof access_token !== "string" || access_token === "") return { ok: false, reason: "auth_incomplete" }
  if (typeof account_id !== "string" || account_id === "") return { ok: false, reason: "auth_incomplete" }
  return { ok: true, access_token, account_id }
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

// 對映（spec 36 store contract 勘誤版）：used_percent 直接對映（超界折 null，不得傳播錯誤數字）、
// reset_at 直接對映（epoch 秒）、limit_window_seconds / 60 → window_minutes。
function normalizeWindow(value: unknown): CodexQuotaWindow | null {
  if (!isRecord(value)) return null
  const used_percent = isValidUsedPercent(value.used_percent) ? value.used_percent : null
  const reset_at = isPositiveFiniteNumber(value.reset_at) ? value.reset_at : null
  const window_minutes = isPositiveFiniteNumber(value.limit_window_seconds)
    ? value.limit_window_seconds / 60
    : null
  const has_data = used_percent !== null || reset_at !== null || window_minutes !== null
  return has_data ? { used_percent, reset_at, window_minutes } : null
}

function normalizeCredits(value: unknown): CodexCredits | null {
  if (!isRecord(value)) return null
  const has_credits = typeof value.has_credits === "boolean" ? value.has_credits : null
  const unlimited = typeof value.unlimited === "boolean" ? value.unlimited : null
  const has_data = has_credits !== null || unlimited !== null
  return has_data ? { has_credits, unlimited } : null
}

function normalizeUsageResponse(body: unknown, now_ms: number): CodexUsageFetchResult {
  // 缺 rate_limit 代表不是預期的 usage 回應（如 Cloudflare HTML 或 schema 變動），整份拒收。
  if (!isRecord(body) || !isRecord(body.rate_limit)) return { ok: false, reason: "invalid_response" }

  const primary = normalizeWindow(body.rate_limit.primary_window)
  const secondary = normalizeWindow(body.rate_limit.secondary_window)
  // 實測 contract 中 primary_window 恆存在；一個可正規化的 window 都沒有（如 {rate_limit:{}}
  // 或 windows 全 malformed）代表回應無效，視同 fetch 失敗（AC17、spec 36 Issue #2）——
  // 不回空 snapshot，否則 entry 會以新 observed_at 蓋掉較舊但可用的 store。
  if (primary === null && secondary === null) return { ok: false, reason: "invalid_response" }

  return {
    ok: true,
    observation: {
      schema_version: 2,
      provider: "openai",
      source: "codex-usage-api",
      observed_at: new Date(now_ms).toISOString(),
      plan_type: typeof body.plan_type === "string" ? body.plan_type : null,
      // usage API 回應沒有 active_limit 對應欄位（那是 x-codex header 才有的訊號）。
      active_limit: null,
      credits: normalizeCredits(body.credits),
      primary,
      secondary,
    },
  }
}

export async function fetchCodexUsage(options: CodexUsageApiOptions = {}): Promise<CodexUsageFetchResult> {
  const auth = await readCodexAuth(options.auth_file_path ?? resolveCodexAuthFilePath())
  if (!auth.ok) return auth

  const fetch_fn = options.fetch_fn ?? (globalThis.fetch as unknown as FetchLike)
  const base_url = options.base_url ?? CODEX_USAGE_BASE_URL
  const timeout_ms = options.timeout_ms ?? DEFAULT_TIMEOUT_MS

  let response: FetchResponseLike
  try {
    response = await fetch_fn(`${base_url}/wham/usage`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        "chatgpt-account-id": auth.account_id,
      },
      signal: AbortSignal.timeout(timeout_ms),
    })
  } catch {
    return { ok: false, reason: "network_error" }
  }

  if (response.status === 401) return { ok: false, reason: "unauthorized" }
  if (!response.ok) return { ok: false, reason: "http_error" }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, reason: "invalid_response" }
  }

  return normalizeUsageResponse(body, options.now_ms ?? Date.now())
}
