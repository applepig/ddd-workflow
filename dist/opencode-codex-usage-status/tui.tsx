/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { activeLimitRows, compactUsageTier, limitColumns, readProviderUsage } from "./opencode-codex-usage-format.js"

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
  return (
    <>
      {props.separator}{props.columns.label.trim()} <span style={{ fg: percentColor(props.palette(), props.columns) }}>{props.columns.percent.trim()}</span>{props.full ? ` ${props.columns.reset.trim()}` : ""}
    </>
  )
}

function compactColumns(usage, now) {
  return activeLimitRows(usage, now).map((row) => limitColumns(row.label, row, now, usage?.observed_at))
}

// V2 session：footer 列最右端，所有 window 併成一列（spec 50 AC1）。不截斷也不被縮：依 footer 預算選最寬
// 放得下的一階 full → percent → 隱藏（spec 52 AC2）；沒有 sessionID（home 的 prompt）、shell 模式與
// footer 收起細節時不顯示。外層 box 永遠 render 供量測，隱藏時 visible=false 退出 layout、不吃列的 gap。
function CompactUsageView(props) {
  const columns = createMemo(() => compactColumns(props.usage(), props.now()))
  const tier = createMemo(() =>
    !props.sessionID || props.mode === "shell" || !props.showDetails
      ? "hidden"
      : compactUsageTier(columns(), props.budget()),
  )

  return (
    <box ref={props.ref} flexShrink={0} visible={tier() !== "hidden"}>
      <Show when={tier() !== "hidden"}>
        <text fg={props.palette().muted} wrapMode="none" flexShrink={0}>
          <For each={columns()}>
            {(limit, index) => (
              <CompactLimitView
                palette={props.palette}
                separator={index() > 0 ? " · " : ""}
                columns={limit}
                full={tier() === "full"}
              />
            )}
          </For>
        </text>
      </Show>
    </box>
  )
}

// V2 home：首頁底列（全 terminal 寬，只有 MCP／plugin 失敗數／版本號）空間充裕，固定顯示 full、不量測；
// 真的擠時 flexShrink 1＋truncate 讓位給內建項目（spec 52 AC7）。沒有 active window 時整個不 render。
function HomeUsageView(props) {
  const columns = createMemo(() => compactColumns(props.usage(), props.now()))

  return (
    <Show when={columns().length > 0}>
      <text fg={props.palette().muted} wrapMode="none" truncate flexShrink={1}>
        <For each={columns()}>
          {(limit, index) => (
            <CompactLimitView palette={props.palette} separator={index() > 0 ? " · " : ""} columns={limit} full />
          )}
        </For>
      </text>
    </Show>
  )
}

// spec 52 ADR-1／AC1：usage 自己量同列 status box 算預算，不靠 flexShrink 權重分配。gap 對齊
// prompt/index.tsx footer 列的 gap={2}；保留量 R 對齊內建 promptFooterLayout 的 min(28, floor(W/2))，
// W 用量到的 footer 列寬（home 的 prompt 有 maxWidth 75，terminal 寬會高估）。
const FOOTER_GAP = 2
const STATUS_RESERVE_MAX = 28

// 每個 footer 實例各自量測；status 與 usage 共用的空間不隨 usage 選哪一階而變，所以不需要 hysteresis。
function createFooterBudget() {
  const [budget, setBudget] = createSignal()
  let usage_el
  let status_el

  // ref 回呼時還沒掛上 footer 列；status 的 resize 在 layout 走訪途中發出，同列後面的 usage 寬度還沒更新。
  // 一律排到 microtask，等整趟 layout 結束再量。
  const schedule = () => queueMicrotask(measure)

  function watchStatus(next) {
    if (next === status_el) return
    status_el?.off("resize", schedule)
    status_el = next
    status_el?.on("resize", schedule)
  }

  function measure() {
    const row = usage_el?.parent
    const first = row?.getChildren()[0]
    // 量不到 status（還沒掛上列、或列首就是自己）就不顯示。
    watchStatus(first !== usage_el ? first : undefined)
    if (!status_el) {
      setBudget(undefined)
      return
    }
    const reserve = Math.min(STATUS_RESERVE_MAX, Math.floor(row.width / 2))
    const usage_space = usage_el.visible ? usage_el.width + FOOTER_GAP : 0
    setBudget(status_el.width + usage_space - FOOTER_GAP - reserve)
  }

  // 卸載後晚到的 measure 找不到 usage_el，不會把 listener 掛回去。
  onCleanup(() => {
    usage_el = undefined
    watchStatus(undefined)
  })

  return {
    budget,
    schedule,
    attach(el) {
      usage_el = el
      schedule()
    },
  }
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

  // session 掛 prompt.footer（append 落在內建 footer 之後，列最右端），依量測預算降階；home 的 prompt 有
  // maxWidth 75，扣掉內建 shortcuts 後任何一階都放不下，改掛首頁底列 home.footer.status（spec 52 AC7）。
  // 註冊失敗時 runtime 拿不到 cleanup，必須在這裡自己 unregister 已掛的 slot 並停掉 polling，否則 timer 永遠不會被清。
  const unregisters = []
  try {
    unregisters.push(ctx.ui.slot({
      append: "prompt.footer",
      render: (slot) => {
        // 切換 model 時立即重讀新 provider，不等下一輪 polling（spec 50 AC2）。home 的 prompt 也會 mount
        // prompt.footer（只是不顯示），所以這個 effect 同時涵蓋 home.footer.status。
        const provider_id = createMemo(providerID)
        createEffect(on(provider_id, () => void polling.refresh(), { defer: true }))
        // terminal 尺寸改變與 10s tick 時重算預算（spec 52 AC3）；status 寬度變化另由它的 resize 事件觸發。
        const footer = createFooterBudget()
        const dimensions = useTerminalDimensions()
        createEffect(on([dimensions, polling.now], footer.schedule, { defer: true }))
        return (
          <CompactUsageView
            ref={footer.attach}
            budget={footer.budget}
            palette={palette}
            usage={polling.usage}
            now={polling.now}
            sessionID={slot.sessionID}
            mode={slot.mode}
            showDetails={slot.showDetails}
          />
        )
      },
    }))
    unregisters.push(ctx.ui.slot({
      append: "home.footer.status",
      render: () => <HomeUsageView palette={palette} usage={polling.usage} now={polling.now} />,
    }))
  } catch (error) {
    for (const unregister of unregisters) unregister?.()
    polling.stop()
    throw error
  }

  return () => {
    polling.stop()
    for (const unregister of unregisters) unregister?.()
  }
}

export default {
  // dotted id：V2 ctx.storage 的 segment 不接受冒號。
  id: "ddd.opencode-codex-usage-status",
  tui,
  setup,
}
