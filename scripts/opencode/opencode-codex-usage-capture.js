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

function codexHeadersObject(headers) {
  return Object.fromEntries(
    [...headers.entries()]
      .filter(([key]) => key.startsWith("x-codex-"))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

// store_write 一併記入 NDJSON：靜默丟棄（rejected_invalid／skipped_older）過去只能靠猜，
// 把 written/skipped/rejected 結果留在同一筆 log，診斷 capture→store 落差時有據可查。
async function writeDebug(startedAt, url, response, storeWrite) {
  if (!DEBUG) return

  const file = logPath()
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(
    file,
    `${JSON.stringify({
      time: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      request: { host: url.host, pathname: url.pathname },
      response: {
        status: response.status,
        status_text: response.statusText,
        headers: codexHeadersObject(response.headers),
      },
      store_write: storeWrite,
    })}\n`,
  )
}

function capture(startedAt, requestInput, response) {
  const url = requestUrl(requestInput)
  if (!url || !isCodexResponseRequest(url)) return

  // Headers 物件 → header getter adapter（AC26：collector 只吃 getter 契約，不耦合 Headers 實作）；
  // observed_at 是 capture 當下（AC23：觀測時間，updated_at 由 store 寫入時蓋章）。
  const observation = collectCodexQuotaHeaders((name) => response.headers.get(name), new Date().toISOString())
  if (!observation) {
    void writeDebug(startedAt, url, response, "no_observation").catch(() => {})
    return
  }

  void writeCodexUsageSnapshot(observation)
    .then((result) => writeDebug(startedAt, url, response, result))
    .catch(() => {})
}

export default {
  id: "ddd:opencode-codex-usage-capture",
  server: async () => {
    if (globalThis[CODEX_USAGE_CAPTURE]) return {}

    const originalFetch = globalThis.fetch.bind(globalThis)
    globalThis[CODEX_USAGE_CAPTURE] = originalFetch
    globalThis.fetch = async (requestInput, init) => {
      const startedAt = Date.now()
      const response = await originalFetch(requestInput, init)
      capture(startedAt, requestInput, response)
      return response
    }

    return {}
  },
}
