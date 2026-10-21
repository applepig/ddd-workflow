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

// V1／V2 的 theme 形狀不同（V1 扁平 token、V2 巢狀 semantic token）；元件只吃 palette accessor，
// 每次 render 時才讀 token，主題切換後下一次 render 就會換色。
const v1Palette = (api) => () => {
  const theme = api.theme.current
  return { error: theme.error, warning: theme.warning, info: theme.info, muted: theme.textMuted }
}

// V2 的 render throw 會讓 slot 靜默消失，所以缺 token 時退回 muted（再缺就 undefined＝不上色），
// 寧可少了顏色也要讓 usage 文字留著。
const v2Palette = (ctx) => () => {
  const text = ctx.theme?.text
  const muted = text?.muted
  const feedback = text?.feedback
  return {
    error: feedback?.error?.base ?? muted,
    warning: feedback?.warning?.base ?? muted,
    info: feedback?.info?.base ?? muted,
    muted,
  }
}

function percentColor(palette, columns) {
  if (columns.percent_is_stale === true) return palette.muted
  if (columns.percent_value >= 90) return palette.error
  if (columns.percent_value >= 80) return palette.warning
  return palette.info
}

function LimitView(props) {
  const columns = createMemo(() => limitColumns(props.label, props.limit, props.now, props.observed_at))

  return (
    <text fg={props.palette().muted}>
      {columns().label} <span style={{ fg: percentColor(props.palette(), columns()) }}>{columns().percent}</span> reset {columns().reset}
    </text>
  )
}

// V1：prompt 右側，每個 window 一列。
function UsageView(props) {
  const rows = createMemo(() => activeLimitRows(props.usage()))

  return (
    <box flexDirection="column" flexShrink={0}>
      <For each={rows()}>
        {(row) => (
          <LimitView
            palette={props.palette}
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

function CompactLimitView(props) {
  const columns = createMemo(() => limitColumns(props.label, props.limit, props.now, props.observed_at))

  return (
    <text fg={props.palette().muted}>
      {props.separator}{columns().label.trim()} <span style={{ fg: percentColor(props.palette(), columns()) }}>{columns().percent.trim()}</span> {columns().reset.trim()}
    </text>
  )
}

// V2：prompt.footer.status 是 footer 單列，所有 window 併成一列精簡顯示。
function CompactUsageView(props) {
  const rows = createMemo(() => activeLimitRows(props.usage()))

  return (
    <box flexDirection="row" flexShrink={0}>
      <For each={rows()}>
        {(row, index) => (
          <CompactLimitView
            palette={props.palette}
            separator={index() > 0 ? " · " : ""}
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

function startPolling() {
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

  return {
    usage,
    now,
    stop() {
      clearTimeout(initialRetry)
      clearInterval(refreshTimer)
    },
  }
}

// V1（OpenCode 1.x）只呼叫 tui(api)，V2（2.x）只呼叫 setup(ctx)；同一個 default export
// 兩版共用。不加 server key（V1 要求 server／tui 擇一），也不 import @opencode/plugin/tui（V1 沒有）。
const tui = async (api) => {
  const polling = startPolling()
  const palette = v1Palette(api)

  api.lifecycle.onDispose(polling.stop)

  api.slots.register({
    order: 100,
    slots: {
      home_prompt_right(_ctx, _props) {
        return <UsageView palette={palette} usage={polling.usage} now={polling.now} />
      },
      session_prompt_right(_ctx, _props) {
        return <UsageView palette={palette} usage={polling.usage} now={polling.now} />
      },
    },
  })
}

function setup(ctx) {
  const polling = startPolling()
  const palette = v2Palette(ctx)

  // prompt.footer.status 在 home 與 session 都會顯示，註冊一次即可。
  // 註冊失敗時 runtime 拿不到 cleanup，必須在這裡自己停掉 polling，否則 timer 永遠不會被清。
  let unregister
  try {
    unregister = ctx.ui.slot({
      append: "prompt.footer.status",
      render: () => <CompactUsageView palette={palette} usage={polling.usage} now={polling.now} />,
    })
  } catch (error) {
    polling.stop()
    throw error
  }

  return () => {
    polling.stop()
    unregister?.()
  }
}

export default {
  // dotted id：V2 ctx.storage 的 segment 不接受冒號。
  id: "ddd.opencode-codex-usage-status",
  tui,
  setup,
}
