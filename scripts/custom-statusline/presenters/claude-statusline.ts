// Claude statusline presenter（spec 36 M2：AC4 遷移 parity、AC18 動態 rows 的 presenter 基礎）。
// 語意自 scripts/claude/statusline.sh 的 render 段逐條移植：ANSI 色碼、NBSP 排版、
// bar 填格（round）、色彩門檻（colorByPct 60/80、quotaColor 80/90）、model 短名、
// token 縮寫、git Branch row。rows 從固定 Session/Weekly 改為呼叫端組的動態陣列
// （M2：Anthropic 兩列、GPT/unknown 單列 unknown Quota；M3 起依 active windows 動態產生）。

export const BAR_WIDTH = 25

export const FILL_CHAR = "\u2588" // █
export const EMPTY_CHAR = "\u2591" // ░
export const NBSP = "\u00a0" // non-breaking space

export const RST = "\u001b[0m"
export const DIM = "\u001b[2m"
export const WHITE = "\u001b[1;37m"
export const GREEN = "\u001b[32m"
export const YELLOW = "\u001b[33m"
export const RED = "\u001b[31m"
export const CYAN = "\u001b[36m"

// bar 色彩方案：Context 用 colorByPct（60/80 門檻）、quota rows 用 quotaColor（80/90 門檻）。
export type BarColorScheme = "context" | "quota"

export interface StatuslineBarRowView {
  label: string
  // null = unknown：--%、bar 全空（spec 36 預期畫面 §GPT 無資料／invalid／stale）。
  pct: number | null
  scheme: BarColorScheme
  extra: string
}

export interface StatuslineGitView {
  branch: string
  insertions: number
  deletions: number
  // untracked 檔案數（單位是「檔案」，非 +/- 的「行」）；0 時不顯示以減少版面雜訊。
  untracked: number
}

export interface StatuslineView {
  model_short: string
  effort_level: string | null
  dir_name: string
  bar_rows: StatuslineBarRowView[]
  git: StatuslineGitView | null
}

// model id → 短名：claude-opus-4-8[1m] → Opus 4.8[1M]、claude-fable-5 → Fable 5、
// 無法辨識（GPT／unknown）原樣 passthrough。
export function formatModel(raw_id: string): string {
  const suffix = /\[1[mM]\]/.test(raw_id) ? "[1M]" : ""
  // bash ${raw%%\[*} parity：從第一個 [ 起截斷。
  const raw = raw_id.replace(/\[[\s\S]*$/, "")

  const with_minor = raw.match(/^claude-([a-z]+)-([0-9]+)-([0-9]+)/)
  if (with_minor !== null) {
    return `${capitalize(with_minor[1])} ${with_minor[2]}.${with_minor[3]}${suffix}`
  }
  const major_only = raw.match(/^claude-([a-z]+)-([0-9]+)$/)
  if (major_only !== null) {
    return `${capitalize(major_only[1])} ${major_only[2]}${suffix}`
  }
  return `${raw}${suffix}`
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// token 數縮寫：>=1000 顯示為 {n}k（截尾除法，bash 整數運算 parity）。
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${Math.floor(tokens / 1000)}k`
  return `${tokens}`
}

// 百分比正規化為 0–100 整數（bash normalizePct 的 jq round＋clamp parity）。
export function normalizePct(pct: number): number {
  const rounded = Number.isFinite(pct) ? Math.round(pct) : 0
  if (rounded < 0) return 0
  if (rounded > 100) return 100
  return rounded
}

// 依 bar 寬度等比例換算填滿格數，round 而非 floor（bash (pct*width+50)/100 parity）。
export function pctToFilled(pct: number, width: number): number {
  return Math.floor((pct * width + 50) / 100)
}

// Context bar 色彩：0–60% 綠、60–80% 黃、80%+ 紅。
export function colorByPct(pct: number): string {
  if (pct >= 80) return RED
  if (pct >= 60) return YELLOW
  return GREEN
}

// quota bar 色彩（Session／Weekly 共用）：0–80% 藍、80–90% 黃、90%+ 紅。
export function quotaColor(pct: number): string {
  if (pct >= 90) return RED
  if (pct >= 80) return YELLOW
  return CYAN
}

export function makeBar(filled: number, width: number, color: string): string {
  const clamped = Math.min(Math.max(filled, 0), width)
  const empty = width - clamped
  let bar = ""
  if (clamped > 0) bar += `${color}${FILL_CHAR.repeat(clamped)}${RST}`
  if (empty > 0) bar += `${DIM}${EMPTY_CHAR.repeat(empty)}${RST}`
  return bar
}

export function nbspify(text: string): string {
  return text.replaceAll(" ", NBSP)
}

// 百分比欄位最小寬度（"NN%"／"--%" 皆 3 欄）；"100%" 為 4 欄時由呼叫端整列升寬（AC34）。
const MIN_PCT_FIELD_WIDTH = 3

// pct_text → 顯示字串（"43" 或 unknown 的 "--"）。
function pctText(pct: number | null): string {
  return pct === null ? "--" : `${pct}`
}

// 一次 render 內百分比欄位統一寬度：取全列 "{pct}%" 的最大長度、下限 3
// （只有 "100%" 會逼到 4）；讓 100% 與其他列的 `|` 與 extra 恆對齊（AC34）。
function resolvePctFieldWidth(bar_rows: StatuslineBarRowView[]): number {
  let width = MIN_PCT_FIELD_WIDTH
  for (const row of bar_rows) {
    width = Math.max(width, `${pctText(row.pct)}%`.length)
  }
  return width
}

// 渲染一行 bar 列：{label 補齊 7}{NBSP}{bar}{NBSP}{pct 補齊 pct_width}{NBSP}|{NBSP}{extra}
// 整列 nbspify（bar 內無半形空格）。
function makeBarRowLine(label: string, bar: string, pct_text: string, extra: string, pct_width: number): string {
  const label_padded = label.padEnd(7)
  const pct_padded = `${pct_text}%`.padEnd(pct_width)
  return nbspify(`${label_padded}${NBSP}${bar}${NBSP}${WHITE}${pct_padded}${RST}${NBSP}|${NBSP}${extra}`)
}

const SEP = `${NBSP}|${NBSP}`

export function renderStatuslineView(view: StatuslineView): string {
  // effort level 依使用者偏好直接顯示、不轉大寫（bash parity）。
  const model_display =
    view.effort_level !== null && view.effort_level !== ""
      ? `${view.model_short} ${view.effort_level}`
      : view.model_short

  const line1 =
    `${nbspify("Model:")}${NBSP}${WHITE}${nbspify(model_display)}${RST}` +
    `${SEP}${nbspify("Dir:")}${NBSP}${WHITE}${nbspify(view.dir_name)}${RST}`

  // 每行前綴 RST：覆蓋 Claude Code 對 statusline 的 dim（bash parity）。
  let output = `${RST}${line1}`

  const pct_width = resolvePctFieldWidth(view.bar_rows)
  for (const row of view.bar_rows) {
    const filled = row.pct === null ? 0 : pctToFilled(row.pct, BAR_WIDTH)
    const color = row.pct === null ? "" : row.scheme === "context" ? colorByPct(row.pct) : quotaColor(row.pct)
    const bar = makeBar(filled, BAR_WIDTH, color)
    output += `\n${RST}${makeBarRowLine(row.label, bar, pctText(row.pct), row.extra, pct_width)}`
  }

  // Branch row 僅在 git repo 內（branch 非空）顯示；+/- diff 永遠顯示、含 0，
  // untracked（?N）僅在有未追蹤檔案時附加（單位不同，避免常見的 ?0 佔版面）。
  if (view.git !== null && view.git.branch !== "") {
    const untracked_str = view.git.untracked > 0 ? `,${NBSP}${YELLOW}?${view.git.untracked}${RST}` : ""
    const diff_str = `${NBSP}(${GREEN}+${view.git.insertions}${RST},${NBSP}${RED}-${view.git.deletions}${RST}${untracked_str})`
    output += `\n${RST}${nbspify("Branch:")}${NBSP}${WHITE}${nbspify(view.git.branch)}${RST}${diff_str}`
  }

  return output
}
