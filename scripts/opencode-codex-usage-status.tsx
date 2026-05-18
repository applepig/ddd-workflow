/** @jsxImportSource @opentui/solid */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createMemo, createSignal, Show } from "solid-js"

const USAGE_FILE = ".opencode/codex-usage.json"
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

function usagePaths(api) {
  const root = api.state.path.worktree && api.state.path.worktree !== "/" ? api.state.path.worktree : api.state.path.directory
  return [
    root ? path.join(root, USAGE_FILE) : undefined,
    api.state.path.directory ? path.join(api.state.path.directory, USAGE_FILE) : undefined,
    path.join(process.cwd(), USAGE_FILE),
    path.join(PLUGIN_DIR, "..", "codex-usage.json"),
  ].filter((item, index, list) => item && list.indexOf(item) === index)
}

async function readUsage(api) {
  for (const file of usagePaths(api)) {
    try {
      return JSON.parse(await readFile(file, "utf8"))
    } catch {}
  }
  return undefined
}

function colorByUsage(theme, pct) {
  if (pct >= 90) return theme.error
  if (pct >= 80) return theme.warning
  return theme.info
}

function formatRemaining(resetAt, now) {
  if (!resetAt) return "--:--"

  const remaining = Math.max(0, Math.floor(resetAt - now / 1000))
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)

  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${minutes}m`
  return `${minutes}m`
}

function LimitView(props) {
  const theme = () => props.api.theme.current
  const pct = createMemo(() => Math.round(props.limit?.used_percent ?? 0))

  return (
    <text fg={theme().textMuted}>
      {props.label} <span style={{ fg: colorByUsage(theme(), pct()) }}>{pct()}%</span> reset{" "}
      {formatRemaining(props.limit?.reset_at, props.now)}
    </text>
  )
}

function UsageView(props) {
  const primary = createMemo(() => props.usage()?.primary)
  const secondary = createMemo(() => props.usage()?.secondary)

  return (
    <Show when={props.usage()}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <LimitView api={props.api} label="5hr" limit={primary()} now={props.now()} />
        <text fg={props.api.theme.current.textMuted}>|</text>
        <LimitView api={props.api} label="weekly" limit={secondary()} now={props.now()} />
      </box>
    </Show>
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
      setUsage(await readUsage(api))
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
