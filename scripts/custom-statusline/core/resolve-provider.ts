import type { ProviderKind } from "./types.ts"

// 路由只認 model id 的 pattern（ADR-1）：rate_limits、context window、cost、
// display name 都不得作為 provider 判斷依據（AC3）。
const OPENAI_CODEX_ID_PREFIXES = ["gpt-", "codex,", "openai/"]

function resolveModelId(model: unknown): string | null {
  // 舊 schema：model 欄位本身就是 id 字串（Case 1）。
  if (typeof model === "string") return model
  if (typeof model !== "object" || model === null) return null
  const { id } = model as { id?: unknown }
  return typeof id === "string" ? id : null
}

export function resolveProvider(model: unknown): ProviderKind {
  const model_id = resolveModelId(model)
  if (model_id === null) return "unknown"
  if (model_id.startsWith("claude-")) return "anthropic"
  if (OPENAI_CODEX_ID_PREFIXES.some((prefix) => model_id.startsWith(prefix))) return "openai-codex"
  return "unknown"
}

export function resolveModelDisplayName(model: unknown): string | null {
  if (typeof model === "string") return model
  if (typeof model !== "object" || model === null) return null
  const { display_name } = model as { display_name?: unknown }
  if (typeof display_name === "string") return display_name
  return resolveModelId(model)
}
