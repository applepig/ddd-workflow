import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ─── 匯入待測模組 ───────────────────────────────────────────────────────────────

import {
  TOOL_MAP_GEMINI,
  OPENCODE_DENY_LIST,
  AGENT_OVERRIDES,
  deriveOpencodePermissions,
  deriveCodexSandboxMode,
  deepMerge,
  convertToGemini,
  convertToOpencode,
  convertToCodex,
  build,
} from './build.js'

// ─── 測試資料 ──────────────────────────────────────────────────────────────────

const REVIEWER_FRONTMATTER = {
  name: 'ddd-reviewer',
  description: 'DDD 程式碼審查 subagent——獨立審查程式碼變更，產出 review 報告。\nUse this agent when dispatched by /DDD.xreview for cross-review,\nor when code changes need independent review before committing.',
  model: 'inherit',
  color: 'blue',
  tools: ['Read', 'Grep', 'Glob', 'Bash'],
}

const DEVELOPER_FRONTMATTER = {
  name: 'ddd-developer',
  description: 'DDD 開發者 subagent——以 TDD 循環實作功能程式碼與測試。\nUse this agent when dispatching implementation work during /DDD.work,',
  model: 'inherit',
  color: 'green',
  tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'],
}

const SAMPLE_BODY = '你是 DDD 工作流中的獨立程式碼審查員。\n\n## 核心原則\n\n- **獨立判斷**：不受開發者影響'

// ─── Task 1.2: 映射表與骨架測試 ───────────────────────────────────────────────

describe('TOOL_MAP_GEMINI', () => {
  it('should map Read to read_file', () => {
    expect(TOOL_MAP_GEMINI['Read']).toBe('read_file')
  })

  it('should map Write to write_file', () => {
    expect(TOOL_MAP_GEMINI['Write']).toBe('write_file')
  })

  it('should map Edit to replace', () => {
    expect(TOOL_MAP_GEMINI['Edit']).toBe('replace')
  })

  it('should map Grep to grep_search', () => {
    expect(TOOL_MAP_GEMINI['Grep']).toBe('grep_search')
  })

  it('should map Glob to glob', () => {
    expect(TOOL_MAP_GEMINI['Glob']).toBe('glob')
  })

  it('should map Bash to run_shell_command', () => {
    expect(TOOL_MAP_GEMINI['Bash']).toBe('run_shell_command')
  })
})

describe('OPENCODE_DENY_LIST', () => {
  it('should include webfetch in deny list', () => {
    expect(OPENCODE_DENY_LIST).toContain('webfetch')
  })

  it('should include websearch in deny list', () => {
    expect(OPENCODE_DENY_LIST).toContain('websearch')
  })

  it('should include task in deny list', () => {
    expect(OPENCODE_DENY_LIST).toContain('task')
  })

  it('should include doom_loop in deny list', () => {
    expect(OPENCODE_DENY_LIST).toContain('doom_loop')
  })

  it('should include all 9 deny items', () => {
    expect(OPENCODE_DENY_LIST).toHaveLength(9)
  })
})

describe('AGENT_OVERRIDES', () => {
  it('should have ddd-reviewer override', () => {
    expect(AGENT_OVERRIDES['ddd-reviewer']).toBeDefined()
  })

  it('should set ddd-reviewer opencode mode to primary', () => {
    expect(AGENT_OVERRIDES['ddd-reviewer'].opencode.mode).toBe('primary')
  })

  it('should contain bash permission whitelist for ddd-reviewer', () => {
    const bash_perm = AGENT_OVERRIDES['ddd-reviewer'].opencode.permission.bash
    expect(bash_perm).toBeDefined()
    expect(bash_perm['*']).toBe('deny')
    expect(bash_perm['git log*']).toBe('allow')
    expect(bash_perm['git diff*']).toBe('allow')
  })

  it('should contain external_directory permission for ddd-reviewer', () => {
    const ext_dir = AGENT_OVERRIDES['ddd-reviewer'].opencode.permission.external_directory
    expect(ext_dir).toBeDefined()
    expect(ext_dir['*']).toBe('deny')
    expect(ext_dir['/tmp/*']).toBe('allow')
  })
})

// ─── Task 1.2: deriveOpencodePermissions 測試 ─────────────────────────────────

describe('deriveOpencodePermissions', () => {
  it('should return read allow and list allow when tools includes Read', () => {
    const result = deriveOpencodePermissions(['Read'])
    expect(result.read).toBe('allow')
    expect(result.list).toBe('allow')
  })

  it('should return grep allow when tools includes Grep', () => {
    const result = deriveOpencodePermissions(['Grep'])
    expect(result.grep).toBe('allow')
  })

  it('should return glob allow when tools includes Glob', () => {
    const result = deriveOpencodePermissions(['Glob'])
    expect(result.glob).toBe('allow')
  })

  it('should return edit allow when tools includes Write', () => {
    const result = deriveOpencodePermissions(['Write'])
    expect(result.edit).toBe('allow')
  })

  it('should return edit allow when tools includes Edit', () => {
    const result = deriveOpencodePermissions(['Edit'])
    expect(result.edit).toBe('allow')
  })

  it('should return bash allow when tools includes Bash', () => {
    const result = deriveOpencodePermissions(['Bash'])
    expect(result.bash).toBe('allow')
  })

  it('should deny all deny-list items when no matching tools', () => {
    const result = deriveOpencodePermissions([])
    for (const item of OPENCODE_DENY_LIST) {
      expect(result[item]).toBe('deny')
    }
  })

  it('should deny read and list when Read is not in tools', () => {
    const result = deriveOpencodePermissions(['Bash'])
    expect(result.read).toBe('deny')
    expect(result.list).toBe('deny')
  })

  it('should handle reviewer tools correctly', () => {
    const result = deriveOpencodePermissions(['Read', 'Grep', 'Glob', 'Bash'])
    expect(result.read).toBe('allow')
    expect(result.grep).toBe('allow')
    expect(result.glob).toBe('allow')
    expect(result.bash).toBe('allow')
    expect(result.edit).toBe('deny')
  })
})

// ─── Task 1.2: deriveCodexSandboxMode 測試 ────────────────────────────────────

describe('deriveCodexSandboxMode', () => {
  it('should return workspace-write when tools includes Write', () => {
    expect(deriveCodexSandboxMode(['Read', 'Write'])).toBe('workspace-write')
  })

  it('should return workspace-write when tools includes Edit', () => {
    expect(deriveCodexSandboxMode(['Read', 'Edit'])).toBe('workspace-write')
  })

  it('should return read-only when tools has no Write or Edit', () => {
    expect(deriveCodexSandboxMode(['Read', 'Grep', 'Glob', 'Bash'])).toBe('read-only')
  })

  it('should return read-only for empty tools array', () => {
    expect(deriveCodexSandboxMode([])).toBe('read-only')
  })
})

// ─── Task 1.2: deepMerge 測試 ─────────────────────────────────────────────────

describe('deepMerge', () => {
  it('should merge top-level properties', () => {
    const target = { a: 1, b: 2 }
    const source = { b: 3, c: 4 }
    const result = deepMerge(target, source)
    expect(result).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('should deep merge nested objects', () => {
    const target = { permission: { read: 'allow', bash: 'deny' } }
    const source = { permission: { bash: 'allow', grep: 'deny' } }
    const result = deepMerge(target, source)
    expect(result.permission).toEqual({ read: 'allow', bash: 'allow', grep: 'deny' })
  })

  it('should not mutate the target object', () => {
    const target = { a: 1 }
    const source = { b: 2 }
    deepMerge(target, source)
    expect(target).toEqual({ a: 1 })
  })

  it('should handle source with nested object overriding scalar in target', () => {
    const target = { permission: { bash: 'allow' } }
    const source = { permission: { bash: { '*': 'deny', 'git log*': 'allow' } } }
    const result = deepMerge(target, source)
    expect(result.permission.bash).toEqual({ '*': 'deny', 'git log*': 'allow' })
  })
})

// ─── Task 1.4: Gemini 轉換測試 ────────────────────────────────────────────────

describe('convertToGemini', () => {
  it('should map tool names from Claude to Gemini format', () => {
    const result = convertToGemini(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('read_file')
    expect(result).toContain('grep_search')
    expect(result).toContain('glob')
    expect(result).toContain('run_shell_command')
    expect(result).not.toContain('"Read"')
    expect(result).not.toContain('"Bash"')
  })

  it('should include Write and Edit as Gemini tool names for developer', () => {
    const result = convertToGemini(DEVELOPER_FRONTMATTER, SAMPLE_BODY, 'ddd-developer')
    expect(result).toContain('write_file')
    expect(result).toContain('replace')
  })

  it('should keep name field', () => {
    const result = convertToGemini(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('name: ddd-reviewer')
  })

  it('should keep description field', () => {
    const result = convertToGemini(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('description:')
  })

  it('should remove permissionMode field if present', () => {
    const fm = { ...REVIEWER_FRONTMATTER, permissionMode: 'restricted' }
    const result = convertToGemini(fm, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).not.toContain('permissionMode')
  })

  it('should remove skills field if present', () => {
    const fm = { ...REVIEWER_FRONTMATTER, skills: ['ddd.work'] }
    const result = convertToGemini(fm, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).not.toContain('skills:')
  })

  it('should remove hooks field if present', () => {
    const fm = { ...REVIEWER_FRONTMATTER, hooks: { pre: 'echo hi' } }
    const result = convertToGemini(fm, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).not.toContain('hooks:')
  })

  it('should preserve color field', () => {
    const result = convertToGemini(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('color: blue')
  })

  it('should rename maxTurns to max_turns', () => {
    const fm = { ...REVIEWER_FRONTMATTER, maxTurns: 30 }
    const result = convertToGemini(fm, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('max_turns:')
    expect(result).not.toContain('maxTurns:')
  })

  it('should preserve markdown body verbatim', () => {
    const result = convertToGemini(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain(SAMPLE_BODY)
  })

  it('should output valid markdown with frontmatter delimiters', () => {
    const result = convertToGemini(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toMatch(/^---\n/)
    expect(result).toContain('\n---\n')
  })
})

// ─── Task 1.6: OpenCode 轉換測試 ──────────────────────────────────────────────

describe('convertToOpencode', () => {
  it('should include name field', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('name: ddd-reviewer')
  })

  it('should include description field', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('description:')
  })

  it('should remove tools field', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).not.toContain('tools:')
  })

  it('should remove color field', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).not.toContain('color:')
  })

  it('should remove model field', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).not.toContain('model:')
  })

  it('should derive read allow from Read tool', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('read: allow')
  })

  it('should derive bash allow from Bash tool', () => {
    // 使用無 override 的 agent 測試基本 permission 推導
    const result = convertToOpencode(DEVELOPER_FRONTMATTER, SAMPLE_BODY, 'ddd-developer')
    expect(result).toContain('bash: allow')
  })

  it('should deny edit when neither Write nor Edit in tools for reviewer', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('edit: deny')
  })

  it('should allow edit when Write is in tools for developer', () => {
    const result = convertToOpencode(DEVELOPER_FRONTMATTER, SAMPLE_BODY, 'ddd-developer')
    expect(result).toContain('edit: allow')
  })

  it('should include default mode subagent for non-overridden agent', () => {
    const result = convertToOpencode(DEVELOPER_FRONTMATTER, SAMPLE_BODY, 'ddd-developer')
    expect(result).toContain('mode: subagent')
  })

  it('should include default steps 50 when no maxTurns', () => {
    const result = convertToOpencode(DEVELOPER_FRONTMATTER, SAMPLE_BODY, 'ddd-developer')
    expect(result).toContain('steps: 50')
  })

  it('should use maxTurns value as steps when provided', () => {
    const fm = { ...DEVELOPER_FRONTMATTER, maxTurns: 30 }
    const result = convertToOpencode(fm, SAMPLE_BODY, 'ddd-developer')
    expect(result).toContain('steps: 30')
  })

  it('should apply ddd-reviewer override: mode becomes primary', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('mode: primary')
    expect(result).not.toContain('mode: subagent')
  })

  it('should apply ddd-reviewer override: bash whitelist in permission', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('git log*')
    expect(result).toContain('git diff*')
  })

  it('should apply ddd-reviewer override: external_directory permission', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('external_directory:')
    expect(result).toContain('/tmp/*')
  })

  it('should deny doom_loop in permission', () => {
    const result = convertToOpencode(DEVELOPER_FRONTMATTER, SAMPLE_BODY, 'ddd-developer')
    expect(result).toContain('doom_loop: deny')
  })

  it('should preserve markdown body', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain(SAMPLE_BODY)
  })

  it('should output valid markdown with frontmatter delimiters', () => {
    const result = convertToOpencode(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toMatch(/^---\n/)
    expect(result).toContain('\n---\n')
  })
})

// ─── Task 1.8: Codex 轉換測試 ─────────────────────────────────────────────────

describe('convertToCodex', () => {
  it('should output TOML format with name field', () => {
    const result = convertToCodex(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('name = "ddd-reviewer"')
  })

  it('should output description as TOML multiline string', () => {
    const result = convertToCodex(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toMatch(/description\s*=\s*"""/)
  })

  it('should output developer_instructions with body content', () => {
    const result = convertToCodex(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('developer_instructions')
    expect(result).toContain(SAMPLE_BODY)
  })

  it('should output developer_instructions as TOML triple-quoted string', () => {
    const result = convertToCodex(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toMatch(/developer_instructions\s*=\s*"""/)
  })

  it('should set sandbox_mode read-only for reviewer with no Write/Edit', () => {
    const result = convertToCodex(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('sandbox_mode = "read-only"')
  })

  it('should set sandbox_mode workspace-write for developer with Write', () => {
    const result = convertToCodex(DEVELOPER_FRONTMATTER, SAMPLE_BODY, 'ddd-developer')
    expect(result).toContain('sandbox_mode = "workspace-write"')
  })

  it('should not include color field in TOML output', () => {
    const result = convertToCodex(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).not.toContain('color')
  })

  it('should not include model field in TOML output', () => {
    const result = convertToCodex(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).not.toContain('model')
  })

  it('should not include tools field in TOML output', () => {
    const result = convertToCodex(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).not.toContain('tools')
  })
})

// ─── Task 1.10: build 主流程測試 ──────────────────────────────────────────────

describe('build', () => {
  const WORK_DIR = resolve(import.meta.dirname, '..')
  const dist_dir = join(WORK_DIR, 'dist')
  const agents_src = join(WORK_DIR, 'ddd-workflow', 'agents')

  afterEach(() => {
    // 清理 dist（如果測試中建立的）
    if (existsSync(dist_dir)) {
      rmSync(dist_dir, { recursive: true })
    }
  })

  it('should create dist/gemini/agents/ directory', async () => {
    await build()
    expect(existsSync(join(dist_dir, 'gemini', 'agents'))).toBe(true)
  })

  it('should create dist/opencode/agents/ directory', async () => {
    await build()
    expect(existsSync(join(dist_dir, 'opencode', 'agents'))).toBe(true)
  })

  it('should create dist/codex/agents/ directory', async () => {
    await build()
    expect(existsSync(join(dist_dir, 'codex', 'agents'))).toBe(true)
  })

  it('should output gemini agent files with .md extension', async () => {
    await build()
    const files = readdirSync(join(dist_dir, 'gemini', 'agents'))
    expect(files.some(f => f.endsWith('.md'))).toBe(true)
  })

  it('should output opencode agent files with .md extension', async () => {
    await build()
    const files = readdirSync(join(dist_dir, 'opencode', 'agents'))
    expect(files.some(f => f.endsWith('.md'))).toBe(true)
  })

  it('should output codex agent files with .toml extension', async () => {
    await build()
    const files = readdirSync(join(dist_dir, 'codex', 'agents'))
    expect(files.some(f => f.endsWith('.toml'))).toBe(true)
  })

  it('should process all agent source files', async () => {
    const source_files = readdirSync(agents_src).filter(f => f.endsWith('.md'))
    await build()
    const gemini_files = readdirSync(join(dist_dir, 'gemini', 'agents'))
    expect(gemini_files).toHaveLength(source_files.length)
  })

  it('should clear existing dist before building', async () => {
    // 先建立一個殘留檔案
    mkdirSync(join(dist_dir, 'gemini', 'agents'), { recursive: true })
    const stale_file = join(dist_dir, 'gemini', 'agents', 'stale-agent.md')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(stale_file, 'stale content')

    await build()

    const files = readdirSync(join(dist_dir, 'gemini', 'agents'))
    expect(files).not.toContain('stale-agent.md')
  })
})

// ─── Task 1.12: 邊界案例測試 ──────────────────────────────────────────────────

describe('edge cases', () => {
  it('should warn but not throw when an unknown tool name is encountered', () => {
    const fm = { ...REVIEWER_FRONTMATTER, tools: ['Read', 'UnknownTool', 'Bash'] }
    const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // convertToGemini 應該 warn 但不 throw
    expect(() => convertToGemini(fm, SAMPLE_BODY, 'ddd-reviewer')).not.toThrow()
    expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining('UnknownTool'))

    warn_spy.mockRestore()
  })

  it('should still convert known tools when unknown tool is present', () => {
    const fm = { ...REVIEWER_FRONTMATTER, tools: ['Read', 'UnknownTool', 'Bash'] }
    const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = convertToGemini(fm, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('read_file')
    expect(result).toContain('run_shell_command')

    warn_spy.mockRestore()
  })

  it('should handle empty tools array without error', () => {
    const fm = { ...REVIEWER_FRONTMATTER, tools: [] }
    expect(() => convertToGemini(fm, SAMPLE_BODY, 'ddd-reviewer')).not.toThrow()
    expect(() => convertToOpencode(fm, SAMPLE_BODY, 'ddd-reviewer')).not.toThrow()
    expect(() => convertToCodex(fm, SAMPLE_BODY, 'ddd-reviewer')).not.toThrow()
  })

  it('should handle missing tools field without error', () => {
    const fm = { name: 'test-agent', description: 'test', model: 'inherit', color: 'blue' }
    expect(() => convertToGemini(fm, SAMPLE_BODY, 'test-agent')).not.toThrow()
  })

  it('should handle body with special TOML characters in convertToCodex', () => {
    const body_with_toml = 'Content with triple quotes: some """ and backslash \\ here'
    expect(() => convertToCodex(REVIEWER_FRONTMATTER, body_with_toml, 'ddd-reviewer')).not.toThrow()
  })
})

// ─── 修正 3：TOML 轉義強化 ────────────────────────────────────────────────────

describe('escapeTomlMultiline (via convertToCodex)', () => {
  it('should not produce three consecutive double quotes in output for 3-quote input', () => {
    const body = 'some """ triple quotes here'
    const result = convertToCodex(REVIEWER_FRONTMATTER, body, 'ddd-reviewer')
    // 從 developer_instructions 開始的部分不得出現 """ 除了開頭和結尾的多行字串分隔符
    // 找出 developer_instructions = """ 後面到最後 """ 前的內容
    const inner_match = result.match(/developer_instructions\s*=\s*"""\n([\s\S]*?)\n"""/)
    expect(inner_match).not.toBeNull()
    const inner = inner_match[1]
    expect(inner).not.toMatch(/"""/)
  })

  it('should handle 4 consecutive double quotes without producing triple quotes', () => {
    const body = 'four quotes: """"'
    const result = convertToCodex(REVIEWER_FRONTMATTER, body, 'ddd-reviewer')
    const inner_match = result.match(/developer_instructions\s*=\s*"""\n([\s\S]*?)\n"""/)
    expect(inner_match).not.toBeNull()
    const inner = inner_match[1]
    expect(inner).not.toMatch(/"""/)
  })

  it('should handle 5 consecutive double quotes without producing triple quotes', () => {
    const body = 'five quotes: """""'
    const result = convertToCodex(REVIEWER_FRONTMATTER, body, 'ddd-reviewer')
    const inner_match = result.match(/developer_instructions\s*=\s*"""\n([\s\S]*?)\n"""/)
    expect(inner_match).not.toBeNull()
    const inner = inner_match[1]
    expect(inner).not.toMatch(/"""/)
  })

  it('should handle 6 consecutive double quotes without producing triple quotes', () => {
    const body = 'six quotes: """"""'
    const result = convertToCodex(REVIEWER_FRONTMATTER, body, 'ddd-reviewer')
    const inner_match = result.match(/developer_instructions\s*=\s*"""\n([\s\S]*?)\n"""/)
    expect(inner_match).not.toBeNull()
    const inner = inner_match[1]
    expect(inner).not.toMatch(/"""/)
  })

  it('should preserve non-quote content unchanged', () => {
    const body = 'hello world, no special chars'
    const result = convertToCodex(REVIEWER_FRONTMATTER, body, 'ddd-reviewer')
    expect(result).toContain(body)
  })
})

describe('convertToCodex name escaping', () => {
  it('should escape double quotes in agent name', () => {
    const fm = { ...REVIEWER_FRONTMATTER, name: 'agent "with" quotes' }
    const result = convertToCodex(fm, SAMPLE_BODY, 'test')
    // 輸出的 name = "..." 中不應有未轉義的引號
    // 確認包含轉義後的形式
    expect(result).toContain('agent \\"with\\" quotes')
  })

  it('should escape backslashes in agent name', () => {
    const fm = { ...REVIEWER_FRONTMATTER, name: 'agent\\with\\backslash' }
    const result = convertToCodex(fm, SAMPLE_BODY, 'test')
    expect(result).toContain('agent\\\\with\\\\backslash')
  })

  it('should handle normal name without escaping', () => {
    const result = convertToCodex(REVIEWER_FRONTMATTER, SAMPLE_BODY, 'ddd-reviewer')
    expect(result).toContain('name = "ddd-reviewer"')
  })
})
