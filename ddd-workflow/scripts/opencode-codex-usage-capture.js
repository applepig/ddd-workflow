import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

const CODEX_USAGE_CAPTURE = Symbol.for("opencode.codexUsageCapture.fetch")
const CODEX_USAGE_CAPTURE_STATE = Symbol.for("opencode.codexUsageCapture.state")
const CODEX_PATH = "/backend-api/codex/responses"
const USAGE_FILE = ".opencode/codex-usage.json"
const LOG_FILE = ".opencode/openai-response-debug.ndjson"
const DEBUG = process.env.OPENCODE_CODEX_USAGE_DEBUG === "1"

function rootDir(input) {
  return input.worktree && input.worktree !== "/" ? input.worktree : input.directory
}

function usagePath(input) {
  return path.join(rootDir(input), USAGE_FILE)
}

function logPath(input) {
  return path.join(rootDir(input), LOG_FILE)
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

function numberHeader(headers, key) {
  const value = headers.get(key)
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function booleanHeader(headers, key) {
  const value = headers.get(key)
  if (value === null) return undefined
  return value.toLowerCase() === "true"
}

function usageFromHeaders(headers) {
  const primaryResetAt = numberHeader(headers, "x-codex-primary-reset-at")
  const secondaryResetAt = numberHeader(headers, "x-codex-secondary-reset-at")
  if (!primaryResetAt && !secondaryResetAt) return undefined

  return {
    updated_at: new Date().toISOString(),
    plan_type: headers.get("x-codex-plan-type") ?? undefined,
    active_limit: headers.get("x-codex-active-limit") ?? undefined,
    credits: {
      has_credits: booleanHeader(headers, "x-codex-credits-has-credits"),
      unlimited: booleanHeader(headers, "x-codex-credits-unlimited"),
    },
    primary: {
      label: "5hr",
      used_percent: numberHeader(headers, "x-codex-primary-used-percent") ?? 0,
      reset_at: primaryResetAt,
      reset_after_seconds: numberHeader(headers, "x-codex-primary-reset-after-seconds"),
      window_minutes: numberHeader(headers, "x-codex-primary-window-minutes"),
      over_secondary_limit_percent: numberHeader(headers, "x-codex-primary-over-secondary-limit-percent"),
    },
    secondary: {
      label: "weekly",
      used_percent: numberHeader(headers, "x-codex-secondary-used-percent") ?? 0,
      reset_at: secondaryResetAt,
      reset_after_seconds: numberHeader(headers, "x-codex-secondary-reset-after-seconds"),
      window_minutes: numberHeader(headers, "x-codex-secondary-window-minutes"),
    },
  }
}

function codexHeadersObject(headers) {
  return Object.fromEntries(
    [...headers.entries()]
      .filter(([key]) => key.startsWith("x-codex-"))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

async function writeUsage(input, usage) {
  const file = usagePath(input)
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(usage, null, 2) + "\n")
}

async function writeDebug(input, startedAt, url, response) {
  if (!DEBUG) return

  const file = logPath(input)
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
    })}\n`,
  )
}

function capture(input, startedAt, requestInput, response) {
  const url = requestUrl(requestInput)
  if (!url || !isCodexResponseRequest(url)) return

  const usage = usageFromHeaders(response.headers)
  if (!usage) return

  void writeUsage(input, usage).catch(() => {})
  void writeDebug(input, startedAt, url, response).catch(() => {})
}

export default {
  id: "ddd:opencode-codex-usage-capture",
  server: async (input) => {
    globalThis[CODEX_USAGE_CAPTURE_STATE] = { input }
    if (globalThis[CODEX_USAGE_CAPTURE]) return {}

    const originalFetch = globalThis.fetch.bind(globalThis)
    globalThis[CODEX_USAGE_CAPTURE] = originalFetch
    globalThis.fetch = async (requestInput, init) => {
      const startedAt = Date.now()
      const currentInput = globalThis[CODEX_USAGE_CAPTURE_STATE]?.input ?? input
      const response = await originalFetch(requestInput, init)
      capture(currentInput, startedAt, requestInput, response)
      return response
    }

    return {}
  },
}
