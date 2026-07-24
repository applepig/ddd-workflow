// Claude Code statusline callback 的 StatusJSON collector：stdin 字串 → 結構化物件。
// 只做 parse 與正規化，不猜測缺值（null 與 0 語意不同，原樣保留）、不做 provider 判斷
// （provider routing 見 core/resolve-provider.ts）。

export interface StatusJsonModel {
  id: string | null
  display_name: string | null
}

export interface StatusJsonContextUsage {
  input_tokens: number | null
  output_tokens: number | null
  cache_creation_input_tokens: number | null
  cache_read_input_tokens: number | null
}

export interface StatusJsonContextWindow {
  total_input_tokens: number | null
  total_output_tokens: number | null
  context_window_size: number | null
  // 舊 schema 的 current_usage 是單一 token 數字；新 schema 是分項 object；null 表示 callback 沒給。
  current_usage: StatusJsonContextUsage | number | null
  used_percentage: number | null
  remaining_percentage: number | null
}

export interface ClaudeStatusJson {
  model: StatusJsonModel | null
  effort_level: string | null
  context_window: StatusJsonContextWindow | null
  // rate_limits 可能不存在（GPT callback 實測缺少）；存在時保留原始欄位，交由 provider 分支解讀。
  rate_limits: Record<string, unknown> | null
  cwd: string | null
  project_dir: string | null
  // context carry-forward 的 per-session key（v5 AC33）；缺少時不啟用 carry-forward。
  session_id: string | null
}

const EMPTY_STATUS_JSON: ClaudeStatusJson = {
  model: null,
  effort_level: null,
  context_window: null,
  rate_limits: null,
  cwd: null,
  project_dir: null,
  session_id: null,
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

// 只接受有限 number；字串數字視為缺值，不硬轉（不編造預設值）。
function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function parseModel(model: unknown): StatusJsonModel | null {
  // 舊 schema：model 欄位本身就是 id 字串（Case 1）。
  if (typeof model === "string") return { id: model, display_name: null }
  const record = asRecord(model)
  if (record === null) return null
  return {
    id: asString(record.id),
    display_name: asString(record.display_name),
  }
}

function parseCurrentUsage(current_usage: unknown): StatusJsonContextUsage | number | null {
  // 舊 schema：current_usage 直接是 token 總數。
  const legacy_total = asFiniteNumber(current_usage)
  if (legacy_total !== null) return legacy_total
  const record = asRecord(current_usage)
  if (record === null) return null
  return {
    input_tokens: asFiniteNumber(record.input_tokens),
    output_tokens: asFiniteNumber(record.output_tokens),
    cache_creation_input_tokens: asFiniteNumber(record.cache_creation_input_tokens),
    cache_read_input_tokens: asFiniteNumber(record.cache_read_input_tokens),
  }
}

function parseContextWindow(context_window: unknown): StatusJsonContextWindow | null {
  const record = asRecord(context_window)
  if (record === null) return null
  return {
    total_input_tokens: asFiniteNumber(record.total_input_tokens),
    total_output_tokens: asFiniteNumber(record.total_output_tokens),
    context_window_size: asFiniteNumber(record.context_window_size),
    current_usage: parseCurrentUsage(record.current_usage),
    used_percentage: asFiniteNumber(record.used_percentage),
    remaining_percentage: asFiniteNumber(record.remaining_percentage),
  }
}

export function parseClaudeStatusJson(input: string): ClaudeStatusJson {
  let payload: unknown
  try {
    payload = JSON.parse(input)
  } catch {
    return { ...EMPTY_STATUS_JSON }
  }
  const record = asRecord(payload)
  if (record === null) return { ...EMPTY_STATUS_JSON }

  const cwd = asString(record.cwd)
  const workspace = asRecord(record.workspace)
  const effort = asRecord(record.effort)

  return {
    model: parseModel(record.model),
    effort_level: effort === null ? null : asString(effort.level),
    context_window: parseContextWindow(record.context_window),
    rate_limits: asRecord(record.rate_limits),
    cwd,
    // statusline.sh parity：Dir 顯示優先 workspace.project_dir，其次 cwd。
    project_dir: (workspace === null ? null : asString(workspace.project_dir)) ?? cwd,
    session_id: asString(record.session_id),
  }
}
