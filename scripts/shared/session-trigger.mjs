#!/usr/bin/env node

// ==========================================================================
// session-trigger.mjs — Rolling session window keepalive for AI coding CLIs
// ==========================================================================
//
// ## Usage
//
//   node session-trigger.mjs            # run once (one-shot)
//   crontab: 0 7,12,17 * * 1-5 /path/to/session-trigger.mjs >/dev/null 2>&1
//            0 10,15,20 * * 6,0 /path/to/session-trigger.mjs >/dev/null 2>&1
//
// ## Setup
//
//   # claude: --safe-mode disables CLAUDE.md / skills / plugins / hooks / commands
//   # while auth keeps working normally, so the trigger runs under your REAL HOME
//   # and the real ~/.claude/.credentials.json stays the single refresh owner.
//   # An isolated HOME (copied or symlinked credentials) is NOT usable here:
//   # Claude Code rewrites credentials atomically (tmp + rename), which replaces
//   # the symlink with a private file and silently forks the refresh chain.
//
//   # opencode: OPENCODE_DB isolates the session DB so trigger pings don't
//   # pollute `opencode session list`. Auth deliberately stays shared with the
//   # main data home — a second auth.json copy would be a second owner of the
//   # same rotating refresh token, and each refresh invalidates the other side.
//   mkdir -p ~/.session-trigger/opencode-data/opencode
//
//   # agy: each attempt runs in a throwaway HOME (os tmpdir) that symlinks ONLY
//   # ~/.gemini/antigravity-cli/antigravity-oauth-token, then is deleted. agy
//   # refreshes that token in place, so the symlink survives and the real file
//   # stays the single refresh owner; conversations / brain / summaries DB land
//   # in the throwaway HOME, never in the real ~/.gemini. No setup needed.
//
//   Logs are written to ~/.session-trigger/session-trigger.log
//
// ## How the 5-hour rolling window works
//
//   Claude Code (Max/Pro) and Codex CLI (Plus/Pro) each use a 5-hour
//   rolling rate-limit window. The window starts from your FIRST request
//   and resets 5 hours later. If you start coding at 09:00, hit the limit
//   at 10:00, you wait until 14:00 (5h from 09:00).
//
//   This script sends a cheap "hi" ping BEFORE you sit down to work, so
//   the window starts early and resets sooner — reducing your actual wait
//   time from hours to minutes.
//
// ## How this script works
//
//   1. Triggers each CLI in parallel (Claude + Codex + opencode + agy) with
//      minimal-token flags (cheapest model, no tools, custom system prompt, etc.)
//   2. Verifies each trigger succeeded by parsing the rate-limit response:
//      - Claude: `rate_limit_event` in --output-format stream-json --verbose stdout
//      - Codex: `token_count` event in ~/.codex/sessions/ file
//      - opencode: captured `x-codex-*` headers in ~/.cache/ddd-workflow/custom-statusline/codex-usage.json
//      - agy: `gemini-5h` bucket of the "Gemini Models" group in `agy -p /usage`
//        (free, run in the same throwaway HOME); ok needs remaining_fraction < 1
//   3. On failure, applies retry logic based on the window expiry time:
//      - Expires within TOLERANCE (45min) → wait, then retry once
//      - Expires beyond TOLERANCE → skip, wait for the next cron tick
//      - Already expired → retry immediately
//      - Unknown expiry → retry after RETRY_DELAY (30s)
//
// ## Customization
//
//   All tunables are in the constants block below:
//
//   - TOLERANCE_MS   — how close to expiry before we wait-and-retry
//   - RETRY_DELAY_MS — fallback retry delay when expiry time is unknown
//   - EXEC_TIMEOUT_MS — kill CLI if it hangs longer than this
//   - TZ             — timezone for log timestamps
//   - TRIGGER_HOME   — state dir for the log and the opencode session DB
//   - AGENTS[]       — add/remove CLIs here; each entry needs:
//       name, cmd (argv array), parseResult (returns {ok, resets_at, reply}),
//       and optionally cwd / env overrides, or a per-attempt setup/teardown
//       pair whose session supplies cwd / env (agy's throwaway HOME)
//
// ==========================================================================

import { execFile, spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { appendFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// ---------------------------------------------------------------------------
// Constants — all tunables live here
// ---------------------------------------------------------------------------

const TOLERANCE_MS = 45 * 60 * 1000   // 45 minutes — also the minimum headroom a captured window needs
const RETRY_DELAY_MS = 30 * 1000      // 30 seconds (fallback when no resetsAt)
const EXEC_TIMEOUT_MS = 60 * 1000     // 60 seconds
const TZ = "Asia/Taipei"
const TRIGGER_HOME = join(homedir(), ".session-trigger")
const OPENCODE_TRIGGER_DB = join(TRIGGER_HOME, "opencode-data", "opencode", "opencode.db")
const LOG_FILE = join(TRIGGER_HOME, "session-trigger.log")
const OPENCODE_USAGE_FILE = resolveOpencodeUsageFile()
const USER_BIN_PATHS = [join(homedir(), ".opencode", "bin"), join(homedir(), ".local", "bin")]
const TRIGGER_PATH = [...USER_BIN_PATHS, process.env.PATH ?? ""].filter(Boolean).join(":")
const ENABLE_CODEX_TRIGGER = false
const REAL_AGY_DIR = join(homedir(), ".gemini", "antigravity-cli")
const AGY_TOKEN_FILE = "antigravity-oauth-token"
const AGY_QUOTA_GROUP = "Gemini Models"
const AGY_QUOTA_BUCKET = "gemini-5h"
const AGY_PING_AGENT_MD = `---
name: ping
description: Minimal keepalive agent. Replies ok.
excludeDefaultComponents: true
inheritCustomizations: false
tools: []
---
Reply with only the word ok.
`

// AC27（spec 36）：與 custom-statusline/core/codex-usage-store 的
// resolveCodexUsageFilePath 同值——OpenCode capture plugin 寫進的 store，
// 就是這裡讀來驗證 ping 的檔案。解析語意是 shell 的 ${VAR:-fallback}：
// 空字串視同未設定，優先序 DDD_CODEX_USAGE_FILE > XDG_CACHE_HOME > ~/.cache。
export function resolveOpencodeUsageFile(env = process.env) {
  const override = env.DDD_CODEX_USAGE_FILE
  if (typeof override === "string" && override !== "") return override
  const cache_home = env.XDG_CACHE_HOME && env.XDG_CACHE_HOME !== ""
    ? env.XDG_CACHE_HOME
    : join(homedir(), ".cache")
  return join(cache_home, "ddd-workflow", "custom-statusline", "codex-usage.json")
}

const AGENTS = [
  {
    name: "claude",
    cwd: "/tmp",
    cmd: [
      "claude", "-p", "hi", "--output-format", "stream-json", "--verbose",
      "--model", "haiku",
      "--tools", "",
      "--effort", "low",
      "--system-prompt", "Reply with only the word ok.",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--safe-mode",
    ],
    parseResult: parseClaudeResult,
  },
  ...(ENABLE_CODEX_TRIGGER ? [{
    name: "codex",
    cwd: "/tmp",
    cmd: [
      "codex", "exec", "hi", "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-C", "/tmp",
      "-m", "gpt-5.5",
      "-c", `model_reasoning_effort="low"`,
      "--disable", "shell_tool",
      "--disable", "browser_use",
      "--disable", "computer_use",
      "--disable", "image_generation",
      "--disable", "tool_search",
      "--disable", "tool_suggest",
      "--disable", "plugins",
      "--disable", "multi_agent",
      "--disable", "workspace_dependencies",
    ],
    parseResult: parseCodexResult,
  }] : []),
  {
    name: "opencode",
    cwd: "/tmp",
    env: {
      OPENCODE_DB: OPENCODE_TRIGGER_DB,
      OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    },
    cmd: [
      "opencode", "run", "hi",
      "--format", "json",
      "--model", "openai/gpt-5.5",
      "--variant", "low",
      "--agent", "title",
      "--title", "session-trigger",
      "--dir", "/tmp",
    ],
    parseResult: parseOpencodeResult,
  },
  {
    name: "agy",
    cmd: [
      "agy", "-p", "hi",
      "--agent", "ping",
      "--model", "gemini-3.8-flash",
      "--effort", "low",
      "--output-format", "stream-json",
      "--disable-slash-commands",
    ],
    setup: setupAgySession,
    teardown: teardownAgySession,
    parseResult: checkAgyResult,
  },
]

// ---------------------------------------------------------------------------
// Time formatting (GMT+8)
// ---------------------------------------------------------------------------

function formatTW(date_or_ms) {
  const d = typeof date_or_ms === "number" ? new Date(date_or_ms) : date_or_ms
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const g = (type) => p.find((x) => x.type === type)?.value
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}+08:00`
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(agent_name, status, message = "") {
  const ts = formatTW(new Date())
  const suffix = message ? ` ${message}` : ""
  const line = `${ts} [${agent_name}] ${status}${suffix}`
  console.log(line)
  appendFile(LOG_FILE, line + "\n").catch(() => {})
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

function commandExists(cmd) {
  return new Promise((resolve) => {
    execFile("sh", ["-c", "command -v -- \"$1\" >/dev/null", "sh", cmd], { env: { ...process.env, PATH: TRIGGER_PATH } }, (err) => resolve(!err))
  })
}

function run(cmd_args, { timeout_ms = EXEC_TIMEOUT_MS, cwd, env } = {}) {
  return new Promise((resolve) => {
    const [cmd, ...args] = cmd_args
    const spawn_env = { ...process.env, PATH: TRIGGER_PATH, ...env }
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], cwd, env: spawn_env })

    let stdout = ""
    let stderr = ""
    let timed_out = false

    const timer = setTimeout(() => {
      timed_out = true
      child.kill("SIGTERM")
    }, timeout_ms)

    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })

    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exit_code: timed_out ? "TIMEOUT" : (code ?? 1),
      })
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Claude Code: parse result
// ---------------------------------------------------------------------------

// stream-json (--output-format stream-json --verbose) is JSONL: one JSON
// object per line. The verbose flag surfaces a rate_limit_event without
// relying on any ~/.claude config, so the isolated HOME only needs auth.
export function parseClaudeResult(stdout) {
  try {
    const items = parseJsonl(stdout)

    const result_item = items.find((e) => e.type === "result")
    const reply = result_item?.result ?? null

    const event = items.find((e) => e.type === "rate_limit_event")
    if (!event) return { ok: false, resets_at: null, reply }

    const info = event.rate_limit_info
    const resets_at = typeof info.resetsAt === "number" ? info.resetsAt * 1000 : null
    const ok = info.status === "allowed" && resets_at !== null

    return { ok, resets_at, reply }
  } catch {
    return { ok: false, resets_at: null, reply: null }
  }
}

// ---------------------------------------------------------------------------
// Codex CLI: parse result
// ---------------------------------------------------------------------------

function parseJsonl(text) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
}

async function findCodexSessionFile(thread_id) {
  const today = new Date()
  const year = today.getFullYear().toString()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")

  const session_dir = join(homedir(), ".codex", "sessions", year, month, day)

  try {
    const files = await readdir(session_dir)
    const match = files.find((f) => f.includes(thread_id))
    return match ? join(session_dir, match) : null
  } catch {
    return null
  }
}

async function parseCodexResult(stdout) {
  try {
    const events = parseJsonl(stdout)

    const started = events.find((e) => e.type === "thread.started")
    if (!started || !started.thread_id) return { ok: false, resets_at: null, reply: null }

    const thread_id = started.thread_id

    // Extract reply from stdout events
    const completed_items = events.filter((e) => e.type === "item.completed")
    let reply = null
    for (const item of completed_items) {
      const texts = item.item?.content
        ?.filter((c) => c.type === "output_text")
        ?.map((c) => c.text)
      if (texts?.length) reply = texts.join("")
    }

    // Read rate limits from session file
    const session_path = await findCodexSessionFile(thread_id)
    if (!session_path) return { ok: false, resets_at: null, reply }

    const session_content = await readFile(session_path, "utf-8")
    const session_events = parseJsonl(session_content)

    const token_events = session_events.filter(
      (e) => e.type === "event_msg" && e.payload?.type === "token_count"
    )

    if (token_events.length === 0) return { ok: false, resets_at: null, reply }

    const last = token_events[token_events.length - 1]
    const rate_limits = last.payload.rate_limits
    const resets_at_raw = rate_limits?.primary?.resets_at
    const resets_at = typeof resets_at_raw === "number" ? resets_at_raw * 1000 : null
    const ok = resets_at !== null && rate_limits?.rate_limit_reached_type === null

    return { ok, resets_at, reply }
  } catch {
    return { ok: false, resets_at: null, reply: null }
  }
}

// ---------------------------------------------------------------------------
// opencode: parse captured Codex usage headers
// ---------------------------------------------------------------------------

async function readFreshOpencodeUsage(started_at) {
  for (let i = 0; i < 20; i += 1) {
    try {
      const usage = JSON.parse(await readFile(OPENCODE_USAGE_FILE, "utf-8"))
      const updated_at = Date.parse(usage.updated_at)
      if (Number.isFinite(updated_at) && updated_at >= started_at - 1000) return usage
    } catch {}

    await sleep(250)
  }

  return null
}

export function findOpencodeResetAt(usage) {
  for (const window of [usage.primary, usage.secondary]) {
    if (typeof window?.reset_at === "number") return window.reset_at * 1000
  }

  return null
}

// cron 每 5 小時觸發一次，正好等於 codex 的 5h rolling window，於是每次 ping 都落在上一輪
// window 的到期瞬間——後端回的 header 描述的是「即將關閉」的舊 window，reset_at 幾乎等於 now。
// 把這種快照當成功，store 會立刻過期、statusline 一路顯示 --%，而 ping 新開的 window 從沒被
// 觀測到。所以只有還剩餘裕的 window 才算 ok；其餘交給既有 retry 分支，過了邊界再 ping 一次。
//
// 門檻用 TOLERANCE_MS 而非某個小常數：使用者自己的請求會把 window 邊界推離 cron 格點，ping
// 於是落在舊 window 的尾巴（例如只剩 16 分鐘）。判 ok 就不會重試，window 一關就空到下一次
// cron；用同一個 tolerance 才能讓這種尾巴直接落進「睡到邊界再 ping」分支，覆蓋不留洞。
export function isCapturedWindowLive(resets_at, now_ms) {
  return resets_at !== null && resets_at - now_ms > TOLERANCE_MS
}

async function parseOpencodeResult(stdout, { started_at } = {}) {
  const usage = await readFreshOpencodeUsage(started_at ?? 0)
  if (!usage) return { ok: false, resets_at: null, reply: parseOpencodeReply(stdout) }

  const resets_at = findOpencodeResetAt(usage)
  const ok = isCapturedWindowLive(resets_at, Date.now())

  return { ok, resets_at, reply: parseOpencodeReply(stdout) }
}

function parseOpencodeReply(stdout) {
  const events = parseJsonl(stdout)
  const texts = events
    .filter((e) => e.type === "text" && typeof e.part?.text === "string")
    .map((e) => e.part.text)

  return texts.length ? texts.join(" ") : null
}

// ---------------------------------------------------------------------------
// agy (Antigravity CLI): throwaway isolated HOME + /usage verification
// ---------------------------------------------------------------------------

// Every attempt gets a fresh HOME that links ONLY the OAuth token. agy then
// writes its conversations / brain / conversation_summaries.db / logs into the
// throwaway HOME instead of the real ~/.gemini. The token must stay a symlink:
// agy refreshes it in place (verified 2026-10-01), so the real file remains
// the single refresh owner. A copied token would fork the refresh chain.
export async function createAgyIsolatedHome({ real_agy_dir = REAL_AGY_DIR, base_dir = tmpdir() } = {}) {
  const home = await mkdtemp(join(base_dir, "session-trigger-agy-home-"))
  const iso_agy_dir = join(home, ".gemini", "antigravity-cli")
  const workspace = join(home, "ws")

  try {
    await mkdir(iso_agy_dir, { recursive: true })
    await mkdir(join(workspace, ".agents", "agents"), { recursive: true })
    await symlink(join(real_agy_dir, AGY_TOKEN_FILE), join(iso_agy_dir, AGY_TOKEN_FILE))
    await writeFile(join(workspace, ".agents", "agents", "ping.md"), AGY_PING_AGENT_MD)
    return { home, workspace }
  } catch (err) {
    // Same non-following recursive rm as removeAgyIsolatedHome.
    await rm(home, { recursive: true, force: true })
    throw err
  }
}

// fs.rm recursive unlinks symlinks without following them, so the real token
// survives. token_forked means agy replaced the link with a private file
// (changed its write mode), i.e. the isolated copy diverged from the real one.
export async function removeAgyIsolatedHome(home) {
  const iso_token = join(home, ".gemini", "antigravity-cli", AGY_TOKEN_FILE)
  const token_stat = await lstat(iso_token).catch(() => null)
  const token_forked = !token_stat?.isSymbolicLink()
  await rm(home, { recursive: true, force: true })
  return { token_forked }
}

async function setupAgySession() {
  const { home, workspace } = await createAgyIsolatedHome()
  return { home, cwd: workspace, env: { HOME: home } }
}

async function teardownAgySession(session) {
  const { token_forked } = await removeAgyIsolatedHome(session.home)
  if (token_forked) {
    log("agy", "warn:", `isolated ${AGY_TOKEN_FILE} is no longer a symlink — agy changed its write mode, credentials have forked`)
  }
}

// Not-yet-opened window: remaining_fraction stays 1 and reset_time is always
// now+5h, a fake value. Passing it on would land in triggerAgent's "beyond
// tolerance, wait for next tick" branch and abandon a ping that opened nothing,
// so idle reports no resets_at and takes the retry-after-delay branch instead.
export function parseAgyResult(ping_stdout, usage_stdout, now_ms = Date.now()) {
  const reply = parseJsonl(ping_stdout).find((e) => e.event === "result")?.result?.response ?? null
  const failed = { ok: false, resets_at: null, reply }

  try {
    const bucket = JSON.parse(usage_stdout).command.data.groups
      .find((g) => g.name === AGY_QUOTA_GROUP)?.buckets
      ?.find((b) => b.id === AGY_QUOTA_BUCKET)
    if (typeof bucket?.remaining_fraction !== "number") return failed
    if (bucket.remaining_fraction >= 1) return failed

    const parsed = Date.parse(bucket.reset_time)
    const resets_at = Number.isFinite(parsed) ? parsed : null
    return { ok: isCapturedWindowLive(resets_at, now_ms), resets_at, reply }
  } catch {
    return failed
  }
}

// `/usage` is free (no quota) and must run in the same isolated HOME so it
// does not touch the real ~/.gemini either.
async function checkAgyResult(ping_stdout, { cwd, env } = {}) {
  const { stdout } = await run(["agy", "-p", "/usage", "--output-format", "json"], { cwd, env })
  return parseAgyResult(ping_stdout, stdout)
}

// ---------------------------------------------------------------------------
// Core trigger logic
// ---------------------------------------------------------------------------

function formatResetsAt(resets_at_ms) {
  if (!resets_at_ms) return ""
  return `resetsAt=${formatTW(resets_at_ms)}`
}

function truncateReply(reply, max_len = 120) {
  if (!reply) return ""
  const one_line = reply.replace(/\n/g, " ").trim()
  if (one_line.length <= max_len) return `reply="${one_line}"`
  return `reply="${one_line.slice(0, max_len)}…"`
}

async function triggerAgent(agent) {
  const exists = await commandExists(agent.cmd[0])
  if (!exists) {
    log(agent.name, "skip:", `${agent.cmd[0]} not found`)
    return
  }

  const result = await attemptTrigger(agent)

  if (result.ok) {
    log(agent.name, "ok", [formatResetsAt(result.resets_at), truncateReply(result.reply)].filter(Boolean).join(" "))
    return
  }

  const now = Date.now()

  if (result.resets_at !== null) {
    const wait_ms = result.resets_at - now

    if (wait_ms <= 0) {
      log(agent.name, "fail:", `resetsAt already passed, retrying immediately ${truncateReply(result.reply)}`)
      await retryTrigger(agent)
      return
    }

    if (wait_ms <= TOLERANCE_MS) {
      log(agent.name, "fail:", `resetsAt within tolerance, retrying at ${formatTW(result.resets_at)} ${truncateReply(result.reply)}`)
      await sleep(wait_ms)
      await retryTrigger(agent)
      return
    }

    log(agent.name, "fail:", `resetsAt beyond tolerance (${formatResetsAt(result.resets_at)}), waiting for next tick ${truncateReply(result.reply)}`)
    return
  }

  log(agent.name, "fail:", `no resetsAt, retrying in ${RETRY_DELAY_MS / 1000}s ${truncateReply(result.reply)}`)
  await sleep(RETRY_DELAY_MS)
  await retryTrigger(agent)
}

// agent.setup (optional) runs per attempt, retries included, and returns a
// session whose cwd/env override the static ones; agent.teardown always runs.
// Neither may throw out of here: an escaping error reaches main()'s
// process.exit(1) and kills the other agents' triggers running in parallel.
async function attemptTrigger(agent) {
  const started_at = Date.now()
  let session = null

  if (agent.setup) {
    try {
      session = await agent.setup()
    } catch (err) {
      log(agent.name, "fail:", `setup failed — ${err.message}`)
      return { ok: false, resets_at: null, reply: null }
    }
  }

  try {
    const cwd = session?.cwd ?? agent.cwd
    const env = { ...agent.env, ...session?.env }
    const { stdout, stderr, exit_code } = await run(agent.cmd, { cwd, env })

    if (exit_code === "TIMEOUT") {
      log(agent.name, "fail:", "command timed out")
      return { ok: false, resets_at: null, reply: null }
    }

    if (exit_code !== 0 && !stdout) {
      const hint = stderr ? stderr.split("\n")[0].slice(0, 200) : ""
      log(agent.name, "fail:", `exit code ${exit_code}${hint ? " — " + hint : ""}`)
      return { ok: false, resets_at: null, reply: null }
    }

    return await agent.parseResult(stdout, { started_at, cwd, env })
  } finally {
    if (session) {
      try {
        await agent.teardown(session)
      } catch (err) {
        log(agent.name, "warn:", `teardown failed — ${err.message}`)
      }
    }
  }
}

async function retryTrigger(agent) {
  const result = await attemptTrigger(agent)
  const detail = [formatResetsAt(result.resets_at), truncateReply(result.reply)].filter(Boolean).join(" ")

  if (result.ok) {
    log(agent.name, "retry ok", detail)
  } else {
    log(agent.name, "retry fail", detail)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // opencode will not create OPENCODE_DB's parent directory itself — it exits
  // with "unable to open database file" — so make sure it exists first.
  await mkdir(dirname(OPENCODE_TRIGGER_DB), { recursive: true })
  await Promise.all(AGENTS.map((agent) => triggerAgent(agent)))
}

// Compare realpath-resolved filesystem paths, not file URLs: when invoked via a
// symlink, Node resolves import.meta.url to the real file but leaves argv[1] as
// the symlink, so a URL comparison would skip main() and exit 0 silently.
const is_main_module = process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])

if (is_main_module) {
  main().catch((err) => {
    console.error("session-trigger fatal:", err)
    process.exit(1)
  })
}
