/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For } from "solid-js"
import { readCodexUsageRaw } from "./opencode-codex-usage-format.js"
import { activeLimitRows, limitColumns } from "./opencode-codex-usage-format.js"

// 共用 Codex store（spec 36 AC10、ADR-7）：路徑解析（DDD_CODEX_USAGE_FILE／XDG_CACHE_HOME）
// 與 schema 驗證交給 core store 模組。用 raw 讀取讓 stale snapshot 仍能顯示 row，
// format 層只將最後合法 stale 百分比標記為 muted fallback（AC24 v7）。
async function readUsage() {
  try {
    return (await readCodexUsageRaw()) ?? undefined
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
  const columns = createMemo(() => limitColumns(props.label, props.limit, props.now, props.observed_at))

  return (
    <text fg={theme().textMuted}>
      {columns().label} <span style={{ fg: columns().percent_is_stale === true ? theme().textMuted : colorByUsage(theme(), columns().percent_value) }}>{columns().percent}</span> reset {columns().reset}
    </text>
  )
}

function UsageView(props) {
  const rows = createMemo(() => activeLimitRows(props.usage()))

  return (
    <box flexDirection="column" flexShrink={0}>
      <For each={rows()}>
        {(row) => (
          <LimitView
            api={props.api}
            label={row.label}
            limit={row.limit}
            now={props.now()}
            observed_at={props.usage()?.observed_at}
          />
        )}
      </For>
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
