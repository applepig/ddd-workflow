#!/usr/bin/env node

/**
 * AGENTS Build Tool
 *
 * 讀取 ddd-workflow/agents/*.md（Claude 格式），轉換為 Gemini、OpenCode、Codex 三個平台格式，
 * 輸出到 dist/ 目錄。
 *
 * 用法：node scripts/build.js
 */

import matter from 'gray-matter'
import {
  readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync,
} from 'node:fs'
import { join, resolve, basename } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const AGENTS_SRC = join(ROOT, 'ddd-workflow', 'agents')
const DIST = join(ROOT, 'dist')

// ─── 映射表 ──────────────────────────────────────────────────────────────────

/**
 * Claude tool 名稱 → Gemini tool 名稱
 * @type {Record<string, string>}
 */
export const TOOL_MAP_GEMINI = {
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'replace',
  Grep: 'grep_search',
  Glob: 'glob',
  Bash: 'run_shell_command',
}

/**
 * OpenCode 預設拒絕清單（未啟用的 permission 預設為 deny）
 * @type {string[]}
 */
export const OPENCODE_DENY_LIST = [
  'webfetch',
  'websearch',
  'task',
  'question',
  'codesearch',
  'skill',
  'lsp',
  'external_directory',
  'doom_loop',
]

/**
 * Per-agent 特例設定，透過 deep merge 覆蓋預設轉換結果。
 * @type {Record<string, object>}
 */
export const AGENT_OVERRIDES = {
  'ddd-developer': {
    opencode: {
      // ddd.work 的 opencode-worker 用 `--agent ddd-developer` 直接載入這份
      // 為 system prompt；同時保留 subagent 角色給 opencode 內部 task tool
      // 派工。`mode: all` 讓同一份檔案兩用，不需要部署兩個變體。
      mode: 'all',
    },
  },
  'ddd-reviewer': {
    opencode: {
      // xreview runner 用 `--agent ddd-reviewer` 載入這份為 primary system
      // prompt；agents 統一用 dash 分隔（skills 用 dot），不再 rename。
      mode: 'all',
      permission: {
        bash: {
          '*': 'deny',
          'git log*': 'allow',
          'git diff*': 'allow',
          'git show*': 'allow',
          'git status*': 'allow',
          'git branch*': 'allow',
          'git --no-pager*': 'allow',
          'git rev-parse*': 'allow',
          'git merge-base*': 'allow',
          'git ls-files*': 'allow',
          'cat *': 'allow',
          'head *': 'allow',
          'tail *': 'allow',
          'wc *': 'allow',
          'npm test*': 'allow',
          'npm run test*': 'allow',
          'npm run build*': 'allow',
          'pnpm test*': 'allow',
          'pnpm run test*': 'allow',
          'pnpm build*': 'allow',
          'pnpm run build*': 'allow',
          'vitest*': 'allow',
        },
        external_directory: {
          '*': 'deny',
          '/tmp/*': 'allow',
        },
      },
    },
  },
}

// ─── 輔助函式 ────────────────────────────────────────────────────────────────

/**
 * 從 Claude tools 陣列推導 OpenCode permission 物件。
 * @param {string[]} tools
 * @returns {Record<string, string>}
 */
export function deriveOpencodePermissions(tools) {
  const tool_set = new Set(tools ?? [])
  const perm = {}

  // Read → read + list
  perm.read = tool_set.has('Read') ? 'allow' : 'deny'
  perm.list = tool_set.has('Read') ? 'allow' : 'deny'

  // Grep → grep
  perm.grep = tool_set.has('Grep') ? 'allow' : 'deny'

  // Glob → glob
  perm.glob = tool_set.has('Glob') ? 'allow' : 'deny'

  // Write 或 Edit → edit
  perm.edit = (tool_set.has('Write') || tool_set.has('Edit')) ? 'allow' : 'deny'

  // Bash → bash
  perm.bash = tool_set.has('Bash') ? 'allow' : 'deny'

  // 其餘 deny list 中未被允許的項目全部 deny
  for (const item of OPENCODE_DENY_LIST) {
    if (perm[item] === undefined) {
      perm[item] = 'deny'
    }
  }

  return perm
}

/**
 * 從 Claude tools 陣列推導 Codex sandbox_mode。
 * @param {string[]} tools
 * @returns {'workspace-write' | 'read-only'}
 */
export function deriveCodexSandboxMode(tools) {
  const tool_set = new Set(tools ?? [])
  if (tool_set.has('Write') || tool_set.has('Edit')) {
    return 'workspace-write'
  }
  return 'read-only'
}

/**
 * 深度合併兩個物件，不改變 target，回傳新物件。
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
export function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

// ─── Gemini 轉換 ─────────────────────────────────────────────────────────────

// Gemini 不認識的 Claude 專屬欄位
const GEMINI_REMOVE_FIELDS = new Set([
  'permissionMode', 'skills', 'hooks', 'isolation', 'effort',
  'background', 'disallowedTools',
])

/**
 * 將 Claude agent 格式轉換為 Gemini 格式（Markdown + YAML frontmatter）。
 * @param {object} frontmatter  解析後的 frontmatter 物件
 * @param {string} body         Markdown body（原封不動）
 * @param {string} agent_name   agent 名稱（用於 warn 訊息）
 * @returns {string}
 */
export function convertToGemini(frontmatter, body, agent_name) {
  const fm = {}

  for (const [key, value] of Object.entries(frontmatter)) {
    // 移除不認識的欄位
    if (GEMINI_REMOVE_FIELDS.has(key)) continue

    // maxTurns → max_turns
    if (key === 'maxTurns') {
      fm.max_turns = value
      continue
    }

    // tools：映射名稱
    if (key === 'tools') {
      const mapped_tools = []
      for (const tool_name of (value ?? [])) {
        const gemini_name = TOOL_MAP_GEMINI[tool_name]
        if (gemini_name === undefined) {
          console.warn(`[build] ${agent_name}: 未知的 tool 名稱 "${tool_name}"，已跳過`)
        } else {
          mapped_tools.push(gemini_name)
        }
      }
      fm.tools = mapped_tools
      continue
    }

    fm[key] = value
  }

  return matter.stringify(body, fm)
}

// ─── OpenCode 轉換 ───────────────────────────────────────────────────────────

// OpenCode 移除的 Claude 專屬欄位
const OPENCODE_REMOVE_FIELDS = new Set([
  'tools', 'color', 'model', 'permissionMode', 'skills', 'hooks',
  'isolation', 'effort', 'background', 'disallowedTools', 'maxTurns',
])

/**
 * 將 Claude agent 格式轉換為 OpenCode 格式（Markdown + YAML frontmatter）。
 * @param {object} frontmatter
 * @param {string} body
 * @param {string} agent_name
 * @returns {string}
 */
export function convertToOpencode(frontmatter, body, agent_name) {
  // 推導 permission
  const base_permission = deriveOpencodePermissions(frontmatter.tools ?? [])

  // 基礎設定
  const base_fm = {
    name: frontmatter.name,
    description: frontmatter.description,
    mode: 'subagent',
    steps: frontmatter.maxTurns ?? 50,
    permission: base_permission,
  }

  // 保留其他未被移除的欄位（排除已處理的欄位）
  const already_handled = new Set(['name', 'description', 'maxTurns', ...OPENCODE_REMOVE_FIELDS])
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!already_handled.has(key)) {
      base_fm[key] = value
    }
  }

  // 套用 per-agent override
  const override = AGENT_OVERRIDES[agent_name]
  let final_fm = base_fm
  if (override?.opencode) {
    final_fm = deepMerge(base_fm, override.opencode)
  }

  return matter.stringify(body, final_fm)
}

// ─── Codex 轉換 ──────────────────────────────────────────────────────────────

/**
 * 將 TOML 字串值轉義（處理三重引號問題）。
 * 注意：TOML 多行字串中不能有連續 3 個以上的雙引號。
 * 逐字掃描，確保輸出中永遠不會出現連續 3 個雙引號。
 * @param {string} str
 * @returns {string}
 */
function escapeTomlMultiline(str) {
  let result = ''
  let consecutive_quotes = 0
  for (const ch of str) {
    if (ch === '"') {
      consecutive_quotes++
      if (consecutive_quotes === 3) {
        result += '\\'
        consecutive_quotes = 1
      }
      result += ch
    } else {
      consecutive_quotes = 0
      result += ch
    }
  }
  return result
}

/**
 * 將 Claude agent 格式轉換為 Codex TOML 格式。
 * @param {object} frontmatter
 * @param {string} body
 * @param {string} agent_name
 * @returns {string}
 */
export function convertToCodex(frontmatter, body, agent_name) {
  const name = frontmatter.name ?? agent_name
  const description = frontmatter.description ?? ''
  const sandbox_mode = deriveCodexSandboxMode(frontmatter.tools ?? [])

  const escaped_name = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const lines = []
  lines.push(`name = "${escaped_name}"`)
  lines.push(`sandbox_mode = "${sandbox_mode}"`)
  lines.push(`description = """`)
  lines.push(escapeTomlMultiline(description))
  lines.push(`"""`)
  lines.push(`developer_instructions = """`)
  lines.push(escapeTomlMultiline(body))
  lines.push(`"""`)

  return lines.join('\n') + '\n'
}

// ─── Build 主流程 ────────────────────────────────────────────────────────────

/**
 * 清空並重建 dist/ 目錄，然後對每個 agent 原始檔執行三個平台的轉換。
 * 採用兩階段策略：Phase 1 全部解析（不寫入），Phase 2 全部解析成功才清空並寫入。
 * 確保解析失敗時不產出任何 dist/ 產物（原子性）。
 * @returns {Promise<void>}
 */
export async function build() {
  // 掃描原始 agent 檔案
  const agent_files = readdirSync(AGENTS_SRC).filter(f => f.endsWith('.md'))

  // Phase 1：解析所有原始檔（不寫入任何檔案）
  const parsed_agents = []
  for (const filename of agent_files) {
    const filepath = join(AGENTS_SRC, filename)
    const raw = readFileSync(filepath, 'utf-8')

    let parsed
    try {
      parsed = matter(raw)
    } catch (err) {
      console.error(`[build] 解析失敗：${filename}：${err.message}`)
      process.exit(1)
    }

    parsed_agents.push({ filename, frontmatter: parsed.data, body: parsed.content })
  }

  // Phase 2：全部解析成功，清空 dist/ 並寫入
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true })
  }

  // 建立輸出目錄
  const gemini_dir = join(DIST, 'gemini', 'agents')
  const opencode_dir = join(DIST, 'opencode', 'agents')
  const codex_dir = join(DIST, 'codex', 'agents')

  mkdirSync(gemini_dir, { recursive: true })
  mkdirSync(opencode_dir, { recursive: true })
  mkdirSync(codex_dir, { recursive: true })

  for (const { filename, frontmatter, body } of parsed_agents) {
    const agent_name = frontmatter.name ?? basename(filename, '.md')
    const stem = basename(filename, '.md')

    // Gemini：.md
    const gemini_out = convertToGemini(frontmatter, body, agent_name)
    writeFileSync(join(gemini_dir, `${stem}.md`), gemini_out)

    // OpenCode：.md
    // 輸出檔名與來源 stem 一致（agents 統一用 dash，skills 用 dot）。
    // 保留 override.opencode.name 的覆寫管道供未來特例使用，預設 fallback 到 stem。
    const opencode_out = convertToOpencode(frontmatter, body, agent_name)
    const opencode_stem = AGENT_OVERRIDES[agent_name]?.opencode?.name ?? stem
    writeFileSync(join(opencode_dir, `${opencode_stem}.md`), opencode_out)

    // Codex：.toml
    const codex_out = convertToCodex(frontmatter, body, agent_name)
    writeFileSync(join(codex_dir, `${stem}.toml`), codex_out)

    console.log(`[build] ${stem}: gemini, opencode, codex`)
  }

  console.log(`[build] 完成。輸出至 ${DIST}`)
}

// ─── CLI 入口 ─────────────────────────────────────────────────────────────────

// 僅當直接執行時才跑 build()（不被測試 import 時呼叫）
if (import.meta.url === `file://${process.argv[1]}`) {
  build().catch(err => {
    console.error(`[build] 錯誤：${err.message}`)
    process.exit(1)
  })
}
