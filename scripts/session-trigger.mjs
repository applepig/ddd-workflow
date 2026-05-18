#!/usr/bin/env node

// ==========================================================================
// session-trigger.mjs — Rolling session window keepalive for AI coding CLIs
// ==========================================================================
//
// ## Usage
//
//   node session-trigger.mjs            # run once (one-shot)
//   crontab: 0 7,12,17 * * 1-5 /path/to/session-trigger.mjs >/dev/null 2>&1
//
// ## Setup
//
//   # Create a dedicated HOME so Claude won't load your CLAUDE.md / persona:
//   mkdir -p ~/.session-trigger
//   ln -s ~/.claude ~/.session-trigger/.claude
//   touch ~/.session-trigger/CLAUDE.md          # empty file overrides yours
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
//   1. Triggers each CLI in parallel (Claude + Codex) with minimal-token
//      flags (cheapest model, no tools, custom system prompt, etc.)
//   2. Verifies each trigger succeeded by parsing the rate-limit response:
//      - Claude: `rate_limit_event` in --output-format json stdout
//      - Codex: `token_count` event in ~/.codex/sessions/ file
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
//   - TRIGGER_HOME   — isolated HOME dir for Claude (avoids CLAUDE.md)
//   - AGENTS[]       — add/remove CLIs here; each entry needs:
//       name, cmd (argv array), parseResult (returns {ok, resets_at, reply}),
//       and optionally cwd / env overrides
//
// ==========================================================================

import { execFile, spawn } from "node:child_process"
import { appendFile, readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Constants — all tunables live here
// ---------------------------------------------------------------------------

const TOLERANCE_MS = 45 * 60 * 1000   // 45 minutes
const RETRY_DELAY_MS = 30 * 1000      // 30 seconds (fallback when no resetsAt)
const EXEC_TIMEOUT_MS = 60 * 1000     // 60 seconds
const TZ = "Asia/Taipei"
const TRIGGER_HOME = join(homedir(), ".session-trigger")
const LOG_FILE = join(TRIGGER_HOME, "session-trigger.log")

const AGENTS = [
  {
    name: "claude",
    cwd: "/tmp",
    env: { HOME: TRIGGER_HOME },
    cmd: [
      "claude", "-p", "hi", "--output-format", "json",
      "--model", "haiku",
      "--tools", "",
      "--effort", "low",
      "--system-prompt", "Reply with only the word ok.",
      "--no-session-persistence",
      "--disable-slash-commands",
    ],
    parseResult: parseClaudeResult,
  },
  {
    name: "codex",
    cwd: "/tmp",
    cmd: [
      "codex", "exec", "hi", "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-C", "/tmp",
      "-m", "gpt-5.4-mini",
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
    execFile("which", [cmd], (err) => resolve(!err))
  })
}

function run(cmd_args, { timeout_ms = EXEC_TIMEOUT_MS, cwd, env } = {}) {
  return new Promise((resolve) => {
    const [cmd, ...args] = cmd_args
    const spawn_env = env ? { ...process.env, ...env } : undefined
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

function parseClaudeResult(stdout) {
  try {
    const items = JSON.parse(stdout)

    const event = items.find((e) => e.type === "rate_limit_event")
    if (!event) return { ok: false, resets_at: null, reply: null }

    const info = event.rate_limit_info
    const resets_at = typeof info.resetsAt === "number" ? info.resetsAt * 1000 : null
    const ok = info.status === "allowed" && resets_at !== null

    const result_item = items.find((e) => e.type === "result")
    const reply = result_item?.result ?? null

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

async function attemptTrigger(agent) {
  const { stdout, stderr, exit_code } = await run(agent.cmd, { cwd: agent.cwd, env: agent.env })

  if (exit_code === "TIMEOUT") {
    log(agent.name, "fail:", "command timed out")
    return { ok: false, resets_at: null, reply: null }
  }

  if (exit_code !== 0 && !stdout) {
    const hint = stderr ? stderr.split("\n")[0].slice(0, 200) : ""
    log(agent.name, "fail:", `exit code ${exit_code}${hint ? " — " + hint : ""}`)
    return { ok: false, resets_at: null, reply: null }
  }

  return await agent.parseResult(stdout)
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
  await Promise.all(AGENTS.map((agent) => triggerAgent(agent)))
}

main().catch((err) => {
  console.error("session-trigger fatal:", err)
  process.exit(1)
})
