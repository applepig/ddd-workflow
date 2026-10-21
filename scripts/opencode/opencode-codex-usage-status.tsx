/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { activeLimitRows, limitColumns, readProviderUsage } from "./opencode-codex-usage-format.js"

// 資料源由 format 的 providerID → reader registry 決定（spec 50 ADR-3）；openai reader 讀共用 Codex store，
// 路徑解析與 schema 驗證在 core store 模組。stale snapshot 仍會給 row，format 層只把最後合法的
// stale 百分比標成 muted fallback（spec 36 AC24 v7）。reader 拋錯一律當作沒有 usage。
async function readUsage(providerID) {
  try {
    return (await readProviderUsage(providerID)) ?? undefined
  } catch {}
  return undefined
}

// V1／V2 的 theme 形狀不同（V1 扁平 token、V2 巢狀 semantic token）；元件只吃 palette accessor，
// 每次 render 時才讀 token，主題切換後下一次 render 就會換色。
const v1Palette = (api) => () => {
  const theme = api.theme.current
  return { error: theme.error, warning: theme.warning, info: theme.info, muted: theme.textMuted }
}

// V2 的 render throw 會被 slot 的 error boundary 接住：toast「<id> crashed in slot …」後該 slot render null。
// 所以缺 token 時退回 muted（再缺就 undefined＝不上色），不讓缺一個顏色就噴 toast、usage 整段消失。
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

// V1：prompt 右側，每個 window 一列；沒有 active window 時整個不 render，不留空 box（spec 50 AC3）。
function UsageView(props) {
  const rows = createMemo(() => activeLimitRows(props.usage(), props.now()))

  return (
    <Show when={rows().length > 0}>
      <box flexDirection="column" flexShrink={0}>
        <For each={rows()}>
          {(row) => (
            <LimitView
              palette={props.palette}
              label={row.label}
              limit={row}
              now={props.now()}
              observed_at={props.usage()?.observed_at}
            />
          )}
        </For>
      </box>
    </Show>
  )
}

function CompactLimitView(props) {
  const columns = createMemo(() => limitColumns(props.label, props.limit, props.now, props.observed_at))

  return (
    <>
      {props.separator}{columns().label.trim()} <span style={{ fg: percentColor(props.palette(), columns()) }}>{columns().percent.trim()}</span> {columns().reset.trim()}
    </>
  )
}

// V2：footer 列最右端，所有 window 併成一個可截斷的 text（spec 50 AC1）。不設 flexShrink 0，
// 窄畫面時跟左側 dir:branch 一起縮，而不是把它擠掉；shell 模式與 footer 收起細節時不顯示。
function CompactUsageView(props) {
  const rows = createMemo(() => activeLimitRows(props.usage(), props.now()))
  const visible = () => props.mode !== "shell" && Boolean(props.showDetails) && rows().length > 0

  return (
    <Show when={visible()}>
      <text fg={props.palette().muted} wrapMode="none" truncate flexShrink={1}>
        <For each={rows()}>
          {(row, index) => (
            <CompactLimitView
              palette={props.palette}
              separator={index() > 0 ? " · " : ""}
              label={row.label}
              limit={row}
              now={props.now()}
              observed_at={props.usage()?.observed_at}
            />
          )}
        </For>
      </text>
    </Show>
  )
}

function startPolling(providerID) {
  const [result, setResult] = createSignal()
  const [now, setNow] = createSignal(Date.now())
  let latest_request = 0

  // 只採用最後一次發出的 read：切換 provider 時，舊 provider 晚到的結果不能蓋掉新的。
  async function refresh() {
    const provider_id = providerID()
    const request = ++latest_request
    const usage = await readUsage(provider_id)
    if (request === latest_request) setResult({ provider_id, usage })
  }

  void refresh()
  const initialRetry = setTimeout(() => void refresh(), 1000)
  const refreshTimer = setInterval(() => {
    setNow(Date.now())
    void refresh()
  }, 10_000)

  return {
    // 結果只對讀取當下的 provider 有效：model 一換到別的 provider 就不顯示，不等下一輪 polling。
    usage() {
      const current = result()
      return current && current.provider_id === providerID() ? current.usage : undefined
    },
    now,
    refresh,
    stop() {
      clearTimeout(initialRetry)
      clearInterval(refreshTimer)
    },
  }
}

// V1（OpenCode 1.x）只呼叫 tui(api)，V2（2.x）只呼叫 setup(ctx)；同一個 default export
// 兩版共用。不加 server key（V1 要求 server／tui 擇一），也不 import @opencode/plugin/tui（V1 沒有）。
const tui = async (api) => {
  // V1 沒有 current model accessor，固定只讀 openai（spec 50 非目標）。
  const polling = startPolling(() => "openai")
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
  // model.current() 在 render／memo 內呼叫就是 reactive；沒有 model API 或尚未選 model 時當作沒有 provider。
  const providerID = () => ctx.ui.model?.current?.()?.providerID
  const polling = startPolling(providerID)
  const palette = v2Palette(ctx)

  // prompt.footer 在 home 與 session 都會顯示，註冊一次即可；append 落在內建 footer 之後（列最右端）。
  // 註冊失敗時 runtime 拿不到 cleanup，必須在這裡自己停掉 polling，否則 timer 永遠不會被清。
  let unregister
  try {
    unregister = ctx.ui.slot({
      append: "prompt.footer",
      render: (slot) => {
        // 切換 model 時立即重讀新 provider，不等下一輪 polling（spec 50 AC2）。
        const provider_id = createMemo(providerID)
        createEffect(on(provider_id, () => void polling.refresh(), { defer: true }))
        return (
          <CompactUsageView
            palette={palette}
            usage={polling.usage}
            now={polling.now}
            mode={slot.mode}
            showDetails={slot.showDetails}
          />
        )
      },
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
