/** @jsxImportSource @opentui/solid */
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { createMemo, createSignal } from "solid-js"
import { limitColumns } from "./opencode-codex-usage-format.js"

const CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config")
const DATA_DIR = process.env.OPENCODE_CODEX_USAGE_DIR || path.join(CONFIG_HOME, "ddd-workflow", "opencode-codex-usage")
const USAGE_FILE = path.join(DATA_DIR, "codex-usage.json")

async function readUsage() {
  try {
    return JSON.parse(await readFile(USAGE_FILE, "utf8"))
  } catch {}
  return undefined
}

function colorByUsage(theme, pct) {
  if (pct >= 90) return theme.error
  if (pct >= 80) return theme.warning
  return theme.info
}

function LimitView(props) {
  const theme = () => props.api.theme.current
  const columns = createMemo(() => limitColumns(props.label, props.limit, props.now))

  return (
    <text fg={theme().textMuted}>
      {columns().label} <span style={{ fg: colorByUsage(theme(), columns().percent_value) }}>{columns().percent}</span> reset {columns().reset}
    </text>
  )
}

function UsageView(props) {
  const primary = createMemo(() => props.usage()?.primary)
  const secondary = createMemo(() => props.usage()?.secondary)

  return (
    <box flexDirection="column" flexShrink={0}>
      <LimitView api={props.api} label="5hr" limit={primary()} now={props.now()} />
      <LimitView api={props.api} label="week" limit={secondary()} now={props.now()} />
    </box>
  )
}

const tui = async (api) => {
  const [usage, setUsage] = createSignal()
  const [now, setNow] = createSignal(Date.now())
  let refreshInFlight = false

  async function refresh() {
    if (refreshInFlight) return
    refreshInFlight = true
    try {
      setUsage(await readUsage())
    } finally {
      refreshInFlight = false
    }
  }

  void refresh()
  const initialRetry = setTimeout(() => void refresh(), 1000)
  const refreshTimer = setInterval(() => {
    setNow(Date.now())
    void refresh()
  }, 10_000)

  api.lifecycle.onDispose(() => {
    clearTimeout(initialRetry)
    clearInterval(refreshTimer)
  })

  api.slots.register({
    order: 100,
    slots: {
      home_prompt_right(_ctx, _props) {
        return <UsageView api={api} usage={usage} now={now} />
      },
      session_prompt_right(_ctx, _props) {
        return <UsageView api={api} usage={usage} now={now} />
      },
    },
  })
}

export default {
  id: "ddd:opencode-codex-usage-status",
  tui,
}
