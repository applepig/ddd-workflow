// OpenCode fetch 攔截殼（spec 36 AC26、ADR-7）：只負責攔 Codex responses 請求，
// header parse 交給 collectors/codex-quota-headers，寫入交給 core/codex-usage-store 共用 store。
// 舊的手工 parse（?? 0、寫死 label）與 OPENCODE_CODEX_USAGE_DIR 舊路徑已退役（不做 migration）。
import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

import { collectCodexQuotaHeaders } from "../custom-statusline/collectors/codex-quota-headers.ts"
import { resolveCodexUsageFilePath, writeCodexUsageSnapshot } from "../custom-statusline/core/codex-usage-store.ts"

const CODEX_USAGE_CAPTURE = Symbol.for("opencode.codexUsageCapture.fetch")
const CODEX_PATH = "/backend-api/codex/responses"
const LOG_FILE = "openai-response-debug.ndjson"
const DEBUG = process.env.OPENCODE_CODEX_USAGE_DEBUG === "1"

// debug log 跟著共用 store 檔同目錄走，路徑語意（DDD_CODEX_USAGE_FILE／XDG_CACHE_HOME）由 store 模組解析。
function logPath() {
  return path.join(path.dirname(resolveCodexUsageFilePath()), LOG_FILE)
}

function requestUrl(input) {
  try {
    return input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url)
  } catch {
    return undefined
  }
}

function isCodexResponseRequest(input) {
  const url = requestUrl(input)
  return url?.host === "chatgpt.com" && url.pathname === CODEX_PATH
}

// hook／provider 交來的 headers 不保證是 Headers 實例（V2 hook 的 event 形狀未文件化），
// 缺 get／entries 時當作沒有 header，而不是在攔截路徑上拋 TypeError。
function headerGetter(headers) {
  return typeof headers?.get === "function" ? (name) => headers.get(name) : null
}

function codexHeadersObject(headers) {
  if (typeof headers?.entries !== "function") return {}
  return Object.fromEntries(
    [...headers.entries()]
      .filter(([key]) => key.startsWith("x-codex-"))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

// store_write 一併記入 NDJSON：靜默丟棄（rejected_invalid／skipped_older）過去只能靠猜，
// 把 written/skipped/rejected 結果留在同一筆 log，診斷 capture→store 落差時有據可查。
// entry 由呼叫端描述來源（HTTP response 或 WebSocket frame），這裡只負責落地。
async function writeDebug(entry, storeWrite) {
  if (!DEBUG) return

  const file = logPath()
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify({ time: new Date().toISOString(), ...entry, store_write: storeWrite })}\n`)
}

// header getter → store。collector 是唯一的 parse／驗證點（AC26），HTTP 與 WebSocket 兩條路
// 都先 adapt 成 getter 再進來；observed_at 是 capture 當下（AC23）。
function recordQuota(getHeader, debugEntry) {
  const observation = collectCodexQuotaHeaders(getHeader, new Date().toISOString())
  if (!observation) {
    void writeDebug(debugEntry, "no_observation").catch(() => {})
    return
  }

  void writeCodexUsageSnapshot(observation)
    .then((result) => writeDebug(debugEntry, result))
    .catch(() => {})
}

function httpDebugEntry(startedAt, url, response) {
  return {
    duration_ms: Date.now() - startedAt,
    request: url ? { host: url.host, pathname: url.pathname } : null,
    response: {
      status: response.status,
      status_text: response.statusText,
      headers: codexHeadersObject(response.headers),
    },
  }
}

function capture(startedAt, requestInput, response) {
  const url = requestUrl(requestInput)
  if (!url || !isCodexResponseRequest(url)) return

  // Headers 物件 → header getter adapter（AC26：collector 只吃 getter 契約，不耦合 Headers 實作）。
  const getHeader = headerGetter(response?.headers)
  if (!getHeader) return
  recordQuota(getHeader, httpDebugEntry(startedAt, url, response))
}

// OpenCode 2.x 的 codex.rate_limits frame 帶的是與 x-codex-* header 同一組 quota，只是改成 JSON。
// 對映回 header 名稱，沿用同一個 collector 做數值驗證（0／負數／超界折 null）。
function rateLimitsFrameGetter(frame) {
  const limits = frame.rate_limits ?? {}
  const values = {
    "x-codex-plan-type": frame.plan_type,
    "x-codex-credits-has-credits": frame.credits?.has_credits,
    "x-codex-credits-unlimited": frame.credits?.unlimited,
  }
  for (const ordinal of ["primary", "secondary"]) {
    values[`x-codex-${ordinal}-used-percent`] = limits[ordinal]?.used_percent
    values[`x-codex-${ordinal}-reset-at`] = limits[ordinal]?.reset_at
    values[`x-codex-${ordinal}-window-minutes`] = limits[ordinal]?.window_minutes
  }
  return (name) => {
    const value = values[name]
    return value === null || value === undefined ? null : String(value)
  }
}

function captureRateLimitsFrame(event) {
  if (event.model?.providerID !== "openai") return
  // 每個 delta 都會進這個 hook；先字串篩選，避免對整條串流逐一 JSON.parse。
  if (typeof event.frame !== "string" || !event.frame.includes('"codex.rate_limits"')) return

  let frame
  try {
    frame = JSON.parse(event.frame)
  } catch {
    return
  }
  if (frame?.type !== "codex.rate_limits") return

  recordQuota(rateLimitsFrameGetter(frame), {
    websocket: { type: frame.type, kind: event.kind, model: event.model?.id ?? null },
  })
}

// 只讀不改：hook 收到的是可變 event，這裡絕不回寫 frame／response。
function captureHttpResponse(event) {
  if (event.model?.providerID !== "openai") return
  const response = event.response
  const getHeader = headerGetter(response?.headers)
  if (!getHeader) return

  recordQuota(getHeader, httpDebugEntry(Date.now(), requestUrl(event.request ?? response), response))
}

// 觀測是旁路：攔截點上的任何例外都不得外拋，否則 V1 的 provider fetch 或 V2 的 session hook
// 會因為配額紀錄失敗而一起失敗。
function swallow(fn) {
  return (...args) => {
    try {
      fn(...args)
    } catch {}
  }
}

async function registerHook(ctx, name, callback) {
  try {
    await ctx.session.hook(name, swallow(callback), { providerID: "openai" })
  } catch {}
}

// 同一個 default export 兩版共用（OpenCode plugin migration guide「Support V1 and V2 from one package」）：
// V1（>=1.18.29）呼叫 server()，V2 只讀 id 與 setup()、忽略 server()。
export default {
  id: "ddd:opencode-codex-usage-capture",
  server: async () => {
    if (globalThis[CODEX_USAGE_CAPTURE]) return {}

    const originalFetch = globalThis.fetch.bind(globalThis)
    globalThis[CODEX_USAGE_CAPTURE] = originalFetch
    globalThis.fetch = async (requestInput, init) => {
      const startedAt = Date.now()
      const response = await originalFetch(requestInput, init)
      swallow(capture)(startedAt, requestInput, response)
      return response
    }

    return {}
  },
  // V2 的 openai provider 走 WebSocket（wss://chatgpt.com/backend-api/codex/responses），不經
  // globalThis.fetch，所以這裡不 patch fetch，改掛 session hook。experimental.ws.receive 在官方
  // 文件標為 experimental；http.response 只在 WebSocket 退回 HTTP 時才會看到 Codex 回應。
  // 兩個 hook 各自註冊：其中一個被改名或拒收時，另一個照常生效，setup() 也不 reject。
  setup: async (ctx) => {
    await registerHook(ctx, "experimental.ws.receive", captureRateLimitsFrame)
    await registerHook(ctx, "http.response", captureHttpResponse)
  },
}
