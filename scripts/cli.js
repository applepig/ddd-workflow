#!/usr/bin/env node

/**
 * AGENTS CLI
 *
 * 用法：
 *   node scripts/cli.js deploy   [claude|gemini|codex|opencode]   symlink 安裝到系統目錄
 *   node scripts/cli.js undeploy [claude|gemini|codex|opencode]   移除 symlink
 *   node scripts/cli.js test     [claude|gemini|codex|opencode]   驗證 symlink + markdown frontmatter
 */

import {
  readFileSync, writeFileSync, mkdirSync, rmSync, existsSync,
  readdirSync, statSync, symlinkSync, readlinkSync,
  renameSync, lstatSync, realpathSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'ddd-workflow')
const DIST = join(ROOT, 'dist')
const HOME = homedir()

const ALL_TARGETS = ['claude', 'gemini', 'codex', 'opencode']

const SKILL_LOCAL_SCRIPT_SYMLINKS = [
  {
    skill: 'ddd.xreview',
    script: 'scripts/xreview-orchestrator.sh',
    expected_target: join(SRC, 'scripts', 'agent-runner.sh'),
  },
  {
    skill: 'ddd.work',
    script: 'scripts/work-orchestrator.sh',
    expected_target: join(SRC, 'scripts', 'agent-runner.sh'),
  },
  {
    skill: 'ddd.work',
    script: 'scripts/opencode-worker.sh',
    expected_target: join(SRC, 'skills', 'ddd.xreview', 'scripts', 'adapters', 'opencode.sh'),
  },
]

const OPENCODE_PLUGIN_FILES = [
  'opencode-codex-usage-capture.js',
]

const OPENCODE_TUI_PLUGIN_FILES = [
  'opencode-codex-usage-status.tsx',
  'opencode-codex-usage-format.js',
]

// ─── Logging ─────────────────────────────────────────────────────────────────

/** @param {string} msg */
function log(msg) { console.log(`[agents] ${msg}`) }

/** @param {string} msg */
function warn(msg) { console.warn(`[agents] WARN: ${msg}`) }

/** @param {string} msg */
function fail(msg) { console.error(`[agents] ERROR: ${msg}`); process.exit(1) }

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * lstatSync 但不 throw（檔案不存在時回 false）
 * @param {string} p
 */
function lstatExists(p) {
  try { lstatSync(p); return true } catch { return false }
}

/**
 * 建立 symlink，已存在則比較後決定更新或跳過。
 * 既有非 symlink 檔案自動備份。
 * @param {string} source
 * @param {string} target
 */
function linkFile(source, target) {
  const real_source = resolve(source)

  if (lstatExists(target) && lstatSync(target).isSymbolicLink()) {
    const current = resolve(readlinkSync(target))
    if (current === real_source) { log(`  已連結: ${target}`); return }
    log(`  更新連結: ${target}`)
    rmSync(target)
  } else if (existsSync(target)) {
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    const backup = `${target}.backup.${ts}`
    warn(`備份現有檔案: ${target} → ${backup}`)
    renameSync(target, backup)
  }

  symlinkSync(source, target)
  log(`  連結完成: ${target} → ${source}`)
}

/**
 * 讀取 JSON 檔案，解析失敗回 null。
 * @param {string} filepath
 * @returns {object | null}
 */
function readJSON(filepath) {
  try { return JSON.parse(readFileSync(filepath, 'utf-8')) } catch { return null }
}

/**
 * 更新 ~/.claude/settings.json 中的 statusLine.command。
 * 若檔案不存在則建立，已正確則跳過。
 */
function updateClaudeSettings() {
  const settings_path = join(HOME, '.claude', 'settings.json')
  const expected_command = 'bash "$HOME/.claude/scripts/statusline.sh"'

  const settings = readJSON(settings_path) ?? {}

  if (settings.statusLine?.type === 'command' && settings.statusLine?.command === expected_command) {
    log('  settings.json statusLine 已正確')
    return
  }

  settings.statusLine = { type: 'command', command: expected_command }
  writeFileSync(settings_path, JSON.stringify(settings, null, 2) + '\n')
  log('  更新 settings.json statusLine.command')
}

/**
 * 清理目標目錄中的 ddd* 項目，再為 source_dir 中的項目建立 symlink。
 * @param {string} source_dir
 * @param {string} target_dir
 * @param {string} label  用於 log 的名稱（如 'skill', 'agent'）
 */
function linkDir(source_dir, target_dir, label) {
  // 確保目標是實體目錄，不是 symlink
  if (lstatExists(target_dir) && lstatSync(target_dir).isSymbolicLink()) {
    log(`  移除舊 ${label}s symlink: ${target_dir}`)
    rmSync(target_dir)
  }
  mkdirSync(target_dir, { recursive: true })

  // 清理舊的 ddd* 項目
  for (const item of readdirSync(target_dir)) {
    if (!item.startsWith('ddd')) continue
    const full = join(target_dir, item)
    log(`  移除: ${item}`)
    rmSync(full, { recursive: true })
  }

  // 建立 symlink
  for (const name of readdirSync(source_dir)) {
    const src_path = join(source_dir, name)
    if (!statSync(src_path).isDirectory() && !name.endsWith('.md') && !name.endsWith('.toml')) continue
    symlinkSync(src_path, join(target_dir, name))
    log(`  連結 ${label}: ${name}`)
  }
}

/**
 * 清理 opencode plugin 目錄中本專案建立、但不在 keep 清單內的舊 codex usage plugin symlink。
 * @param {string} target_dir
 * @param {Set<string>} keep
 */
function cleanOpencodeUsagePluginLinks(target_dir, keep) {
  if (!existsSync(target_dir)) return

  for (const item of readdirSync(target_dir)) {
    if (!item.startsWith('opencode-codex-usage-')) continue
    if (keep.has(item)) continue

    const full = join(target_dir, item)
    if (!lstatExists(full) || !lstatSync(full).isSymbolicLink()) continue

    const link_target = resolve(readlinkSync(full))
    if (!link_target.startsWith(resolve(ROOT))) continue

    rmSync(full)
    log(`  移除舊 opencode plugin: ${item}`)
  }
}

/**
 * 驗證 opencode usage plugin 目錄沒有本專案殘留的舊 symlink。
 * @param {string} target_dir
 * @param {Set<string>} keep
 * @param {string} label
 * @returns {boolean}
 */
function checkNoStaleOpencodeUsagePluginLinks(target_dir, keep, label) {
  if (!existsSync(target_dir)) return true

  let ok = true
  for (const item of readdirSync(target_dir)) {
    if (!item.startsWith('opencode-codex-usage-')) continue
    if (keep.has(item)) continue

    const full = join(target_dir, item)
    if (!lstatExists(full) || !lstatSync(full).isSymbolicLink()) continue

    const link_target = resolve(readlinkSync(full))
    if (!link_target.startsWith(resolve(ROOT))) continue

    warn(`${label}: stale opencode usage plugin symlink remains: ${item} → ${link_target}`)
    ok = false
  }
  return ok
}

// ─── Deploy ──────────────────────────────────────────────────────────────────

/**
 * 部署 xreview config 模板到 ~/.config/ddd-workflow/xreview.json。
 * 已存在則保留使用者設定（model 清單視為個人偏好，不強制覆蓋）。
 * 注意：用 copy 而非 symlink，使用者可自由編輯不影響 repo。
 */
function deployConfig() {
  log('=== config ===')
  const config_dir = join(HOME, '.config', 'ddd-workflow')
  const config_target = join(config_dir, 'xreview.json')
  const config_source = join(SRC, 'config', 'xreview.json')

  if (!existsSync(config_source)) {
    warn(`config 模板不存在: ${config_source}，跳過`)
    return
  }

  if (existsSync(config_target)) {
    log(`  ⚪ ${config_target} 已存在，保留使用者設定`)
    return
  }

  mkdirSync(config_dir, { recursive: true })
  writeFileSync(config_target, readFileSync(config_source, 'utf-8'))
  log(`  ✅ 建立 ${config_target}`)
}

function deployClaude() {
  log('=== claude ===')
  const target = join(HOME, '.claude')
  mkdirSync(target, { recursive: true })

  linkFile(join(SRC, 'references', 'AGENTS.md'), join(target, 'CLAUDE.md'))
  linkDir(join(SRC, 'skills'), join(target, 'skills'), 'skill')
  linkDir(join(SRC, 'agents'), join(target, 'agents'), 'agent')

  // statusline script
  const scripts_dir = join(target, 'scripts')
  mkdirSync(scripts_dir, { recursive: true })
  linkFile(join(SRC, 'scripts', 'statusline.sh'), join(scripts_dir, 'statusline.sh'))

  // settings.json: statusLine.command
  updateClaudeSettings()
}

function deployGemini() {
  log('=== gemini ===')
  const target = join(HOME, '.gemini')
  mkdirSync(target, { recursive: true })

  linkFile(join(SRC, 'references', 'AGENTS.md'), join(target, 'GEMINI.md'))
  linkDir(join(SRC, 'skills'), join(target, 'skills'), 'skill')
  linkDir(join(DIST, 'gemini', 'agents'), join(target, 'agents'), 'agent')
  
  const policies_dir = join(SRC, 'policies')
  if (existsSync(policies_dir)) {
    linkDir(policies_dir, join(target, 'policies'), 'policy')
  }
}

function deployCodex() {
  log('=== codex ===')
  const target = join(HOME, '.codex')
  mkdirSync(target, { recursive: true })

  linkFile(join(SRC, 'references', 'AGENTS.md'), join(target, 'AGENTS.md'))
  linkDir(join(SRC, 'skills'), join(target, 'skills'), 'skill')
  linkDir(join(DIST, 'codex', 'agents'), join(target, 'agents'), 'agent')
}

function deployOpencode() {
  log('=== opencode ===')
  const target = join(HOME, '.config', 'opencode')
  mkdirSync(target, { recursive: true })

  linkFile(join(SRC, 'config', 'opencode-tui.json'), join(target, 'tui.json'))
  const plugins_dir = join(target, 'plugins')
  mkdirSync(plugins_dir, { recursive: true })
  cleanOpencodeUsagePluginLinks(plugins_dir, new Set(OPENCODE_PLUGIN_FILES))
  for (const file of OPENCODE_PLUGIN_FILES) {
    linkFile(join(SRC, 'scripts', file), join(plugins_dir, file))
  }
  const tui_plugins_dir = join(target, 'tui-plugins')
  mkdirSync(tui_plugins_dir, { recursive: true })
  cleanOpencodeUsagePluginLinks(tui_plugins_dir, new Set(OPENCODE_TUI_PLUGIN_FILES))
  for (const file of OPENCODE_TUI_PLUGIN_FILES) {
    linkFile(join(SRC, 'scripts', file), join(tui_plugins_dir, file))
  }
  linkDir(join(SRC, 'skills'), join(target, 'skills'), 'skill')
  linkDir(join(DIST, 'opencode', 'agents'), join(target, 'agents'), 'agent')
}

// ─── Undeploy ────────────────────────────────────────────────────────────────

/**
 * 移除指向本專案的 symlink（只動我們自己建的）。
 * @param {string} target_path
 * @param {string} label
 */
function unlinkIfOurs(target_path, label) {
  if (!lstatExists(target_path)) { log(`  ⚪ ${label} 不存在，跳過`); return }
  if (!lstatSync(target_path).isSymbolicLink()) {
    warn(`${label} 不是 symlink，不移除（可能是使用者自己的檔案）`)
    return
  }
  const link_target = resolve(readlinkSync(target_path))
  if (!link_target.startsWith(resolve(ROOT))) {
    warn(`${label} → ${link_target}（不指向本專案，不移除）`)
    return
  }
  rmSync(target_path)
  log(`  移除: ${label}`)
}

/**
 * 移除目錄中指向本專案的 ddd* symlink。
 * @param {string} dir
 */
function unlinkDirIfOurs(dir) {
  if (!existsSync(dir)) return
  for (const item of readdirSync(dir)) {
    if (!item.startsWith('ddd')) continue
    const full = join(dir, item)
    if (!lstatSync(full).isSymbolicLink()) continue
    const link_target = resolve(readlinkSync(full))
    if (!link_target.startsWith(resolve(ROOT))) continue
    rmSync(full, { recursive: true })
    log(`  移除: ${item}`)
  }
}

function undeployClaude() {
  log('=== claude ===')
  unlinkIfOurs(join(HOME, '.claude', 'CLAUDE.md'), '~/.claude/CLAUDE.md')
  unlinkDirIfOurs(join(HOME, '.claude', 'skills'))
  unlinkDirIfOurs(join(HOME, '.claude', 'agents'))
  unlinkIfOurs(join(HOME, '.claude', 'scripts', 'statusline.sh'), '~/.claude/scripts/statusline.sh')
}

function undeployGemini() {
  log('=== gemini ===')
  unlinkIfOurs(join(HOME, '.gemini', 'GEMINI.md'), '~/.gemini/GEMINI.md')
  unlinkDirIfOurs(join(HOME, '.gemini', 'skills'))
  unlinkDirIfOurs(join(HOME, '.gemini', 'agents'))
  unlinkDirIfOurs(join(HOME, '.gemini', 'policies'))
}

function undeployCodex() {
  log('=== codex ===')
  unlinkIfOurs(join(HOME, '.codex', 'AGENTS.md'), '~/.codex/AGENTS.md')
  unlinkDirIfOurs(join(HOME, '.codex', 'skills'))
  unlinkDirIfOurs(join(HOME, '.codex', 'agents'))
}

function undeployOpencode() {
  log('=== opencode ===')
  unlinkIfOurs(join(HOME, '.config', 'opencode', 'tui.json'), '~/.config/opencode/tui.json')
  for (const file of OPENCODE_PLUGIN_FILES) {
    unlinkIfOurs(join(HOME, '.config', 'opencode', 'plugins', file), `~/.config/opencode/plugins/${file}`)
  }
  for (const file of OPENCODE_TUI_PLUGIN_FILES) {
    unlinkIfOurs(join(HOME, '.config', 'opencode', 'tui-plugins', file), `~/.config/opencode/tui-plugins/${file}`)
  }
  cleanOpencodeUsagePluginLinks(join(HOME, '.config', 'opencode', 'plugins'), new Set())
  cleanOpencodeUsagePluginLinks(join(HOME, '.config', 'opencode', 'tui-plugins'), new Set())
  unlinkDirIfOurs(join(HOME, '.config', 'opencode', 'skills'))
  unlinkDirIfOurs(join(HOME, '.config', 'opencode', 'agents'))
}

// ─── Test ────────────────────────────────────────────────────────────────────

/**
 * 從 markdown 的前幾行解析 YAML frontmatter（只支援簡單 key: value）。
 * @param {string} filepath
 * @returns {Record<string, string>}
 */
function parseFrontmatter(filepath) {
  const content = readFileSync(filepath, 'utf-8')
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*(.+)/)
    if (m) result[m[1].trim()] = m[2].trim()
  }
  return result
}

/**
 * 驗證 skills/ 中每個 SKILL.md 的 frontmatter。
 * @returns {{ ok: boolean, errors: string[] }}
 */
function lintSkills() {
  const errors = []
  const skills_dir = join(SRC, 'skills')
  if (!existsSync(skills_dir)) return { ok: true, errors }

  for (const name of readdirSync(skills_dir)) {
    const skill_md = join(skills_dir, name, 'SKILL.md')
    if (!existsSync(skill_md)) {
      errors.push(`${name}/: 缺少 SKILL.md`)
      continue
    }
    const fm = parseFrontmatter(skill_md)
    for (const field of ['name', 'description']) {
      if (!fm[field]) errors.push(`${name}/SKILL.md: 缺少 frontmatter 欄位 '${field}'`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 驗證 agents/ 中每個 agent .md 的 frontmatter。
 * @returns {{ ok: boolean, errors: string[] }}
 */
function lintAgents() {
  const errors = []
  const agents_dir = join(SRC, 'agents')
  if (!existsSync(agents_dir)) return { ok: true, errors }

  for (const name of readdirSync(agents_dir)) {
    if (!name.endsWith('.md')) continue
    const agent_md = join(agents_dir, name)
    const fm = parseFrontmatter(agent_md)
    for (const field of ['name', 'description', 'model', 'color']) {
      if (!fm[field]) errors.push(`agents/${name}: 缺少 frontmatter 欄位 '${field}'`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 驗證單一 symlink 是否存在且指向本專案。
 * @param {string} path
 * @param {string} label
 * @returns {boolean}
 */
function checkSymlink(path, label) {
  if (!lstatExists(path)) { log(`  ⚪ ${label} 未安裝`); return false }
  if (!lstatSync(path).isSymbolicLink()) { warn(`${label} 存在但不是 symlink`); return false }
  const target = readlinkSync(path)
  log(`  ✅ ${label} → ${target}`)
  return true
}

/**
 * 驗證 symlink 存在且指向指定 target。
 * @param {string} path
 * @param {string} label
 * @param {string} expected_target
 * @returns {boolean}
 */
function checkSymlinkTarget(path, label, expected_target) {
  if (!checkSymlink(path, label)) return false
  const actual = resolve(readlinkSync(path))
  const expected = resolve(expected_target)
  if (actual !== expected) {
    warn(`${label} target mismatch: expected ${expected}, got ${actual}`)
    return false
  }
  return true
}

/**
 * 驗證已安裝 skill namespace 內的 script entrypoint symlink。
 * deploy 會 symlink 整個 skill 目錄，因此這裡檢查 installed path，
 * 並用 script 所在實體目錄解析 relative symlink target。
 * @param {string} skills_dir
 * @param {string} label
 * @returns {boolean}
 */
function checkSkillLocalScriptSymlinks(skills_dir, label) {
  let ok = true

  if (!existsSync(skills_dir)) {
    warn(`${label}: installed skills directory missing`)
    return false
  }

  for (const item of SKILL_LOCAL_SCRIPT_SYMLINKS) {
    const relative_path = `${item.skill}/${item.script}`
    const script_path = join(skills_dir, item.skill, item.script)
    const script_label = `${label} skill-local script ${relative_path}`

    if (!lstatExists(script_path)) {
      warn(`${script_label} missing`)
      ok = false
      continue
    }

    if (!lstatSync(script_path).isSymbolicLink()) {
      warn(`${script_label} expected symlink`)
      ok = false
      continue
    }

    const link_target = readlinkSync(script_path)
    const real_script_dir = realpathSync(join(script_path, '..'))
    const resolved_target = resolve(real_script_dir, link_target)
    const expected_target = resolve(item.expected_target)

    if (resolved_target !== expected_target) {
      warn(`${script_label} target mismatch: expected ${expected_target}, got ${resolved_target}`)
      ok = false
      continue
    }

    log(`  ✅ ${script_label} → ${link_target}`)
  }

  return ok
}

/**
 * 計算目錄中指向本專案的 ddd* symlink 數量。
 * @param {string} dir
 * @param {string} label
 */
function countInstalledLinks(dir, label) {
  if (!existsSync(dir)) { log(`  ⚪ ${label} 目錄不存在`); return }
  const links = readdirSync(dir).filter(f => {
    if (!f.startsWith('ddd')) return false
    const full = join(dir, f)
    return lstatExists(full) && lstatSync(full).isSymbolicLink()
  })
  log(`  ✅ ${label}: ${links.length} 個`)
}

function testClaude() {
  log('=== claude 驗證 ===')
  let ok = true

  // Markdown lint
  const skill_result = lintSkills()
  const agent_result = lintAgents()

  if (skill_result.ok) {
    const count = readdirSync(join(SRC, 'skills')).length
    log(`  ✅ skills frontmatter: ${count} 個全部通過`)
  } else {
    for (const e of skill_result.errors) { warn(`lint: ${e}`); ok = false }
  }

  if (agent_result.ok) {
    const count = readdirSync(join(SRC, 'agents')).filter(f => f.endsWith('.md')).length
    log(`  ✅ agents frontmatter: ${count} 個全部通過`)
  } else {
    for (const e of agent_result.errors) { warn(`lint: ${e}`); ok = false }
  }

  // Symlink 狀態
  if (!checkSymlink(join(HOME, '.claude', 'CLAUDE.md'), '~/.claude/CLAUDE.md')) ok = false
  countInstalledLinks(join(HOME, '.claude', 'skills'), '~/.claude/skills ddd*')
  if (!checkSkillLocalScriptSymlinks(join(HOME, '.claude', 'skills'), '~/.claude/skills')) ok = false
  countInstalledLinks(join(HOME, '.claude', 'agents'), '~/.claude/agents ddd*')
  if (!checkSymlink(join(HOME, '.claude', 'scripts', 'statusline.sh'), '~/.claude/scripts/statusline.sh')) ok = false

  return ok
}

function testGemini() {
  log('=== gemini 驗證 ===')
  let ok = true
  if (!checkSymlink(join(HOME, '.gemini', 'GEMINI.md'), '~/.gemini/GEMINI.md')) ok = false
  countInstalledLinks(join(HOME, '.gemini', 'skills'), '~/.gemini/skills ddd*')
  if (!checkSkillLocalScriptSymlinks(join(HOME, '.gemini', 'skills'), '~/.gemini/skills')) ok = false
  countInstalledLinks(join(HOME, '.gemini', 'agents'), '~/.gemini/agents ddd*')
  countInstalledLinks(join(HOME, '.gemini', 'policies'), '~/.gemini/policies ddd*')
  return ok
}

function testCodex() {
  log('=== codex 驗證 ===')
  let ok = true
  if (!checkSymlink(join(HOME, '.codex', 'AGENTS.md'), '~/.codex/AGENTS.md')) ok = false
  countInstalledLinks(join(HOME, '.codex', 'skills'), '~/.codex/skills ddd*')
  if (!checkSkillLocalScriptSymlinks(join(HOME, '.codex', 'skills'), '~/.codex/skills')) ok = false
  countInstalledLinks(join(HOME, '.codex', 'agents'), '~/.codex/agents ddd*')
  return ok
}

function testOpencode() {
  log('=== opencode 驗證 ===')
  let ok = true
  if (!checkSymlink(join(HOME, '.config', 'opencode', 'tui.json'), '~/.config/opencode/tui.json')) ok = false
  for (const file of OPENCODE_PLUGIN_FILES) {
    if (!checkSymlinkTarget(
      join(HOME, '.config', 'opencode', 'plugins', file),
      `~/.config/opencode/plugins/${file}`,
      join(SRC, 'scripts', file),
    )) ok = false
  }
  for (const file of OPENCODE_TUI_PLUGIN_FILES) {
    if (!checkSymlinkTarget(
      join(HOME, '.config', 'opencode', 'tui-plugins', file),
      `~/.config/opencode/tui-plugins/${file}`,
      join(SRC, 'scripts', file),
    )) ok = false
  }
  if (!checkNoStaleOpencodeUsagePluginLinks(
    join(HOME, '.config', 'opencode', 'plugins'),
    new Set(OPENCODE_PLUGIN_FILES),
    '~/.config/opencode/plugins',
  )) ok = false
  if (!checkNoStaleOpencodeUsagePluginLinks(
    join(HOME, '.config', 'opencode', 'tui-plugins'),
    new Set(OPENCODE_TUI_PLUGIN_FILES),
    '~/.config/opencode/tui-plugins',
  )) ok = false
  countInstalledLinks(join(HOME, '.config', 'opencode', 'skills'), '~/.config/opencode/skills ddd*')
  if (!checkSkillLocalScriptSymlinks(join(HOME, '.config', 'opencode', 'skills'), '~/.config/opencode/skills')) ok = false
  countInstalledLinks(join(HOME, '.config', 'opencode', 'agents'), '~/.config/opencode/agents ddd*')
  return ok
}

// ─── Main ────────────────────────────────────────────────────────────────────

function parseTargets(args) {
  const valid = new Set(ALL_TARGETS)
  const targets = args.filter(a => valid.has(a))
  return targets.length > 0 ? targets : ALL_TARGETS
}

function usage() {
  console.log(`
AGENTS CLI — DDD 工作流跨平台安裝工具

用法：
  node scripts/cli.js <command> [target...]

Commands：
  deploy   [claude|gemini|codex|opencode]   symlink 安裝到系統目錄
  undeploy [claude|gemini|codex|opencode]   移除 symlink（只動本專案建的）
  test     [claude|gemini|codex|opencode]   驗證 symlink 狀態 + markdown frontmatter lint

npm scripts：
  npm run deploy             安裝所有平台
  npm run deploy:claude      只安裝 Claude Code
  npm run undeploy           移除所有平台的 symlink
  npm run undeploy:claude    只移除 Claude Code
  npm test                   驗證安裝狀態

Target 不指定時預設為 all（claude + gemini + codex + opencode）。
`.trim())
}

const deployers = { claude: deployClaude, gemini: deployGemini, codex: deployCodex, opencode: deployOpencode }
const undeployers = { claude: undeployClaude, gemini: undeployGemini, codex: undeployCodex, opencode: undeployOpencode }
const testers = { claude: testClaude, gemini: testGemini, codex: testCodex, opencode: testOpencode }

function main() {
  const [command, ...rest] = process.argv.slice(2)
  const targets = parseTargets(rest)

  if (!command || command === '--help' || command === '-h') {
    usage(); process.exit(0)
  }

  switch (command) {
    case 'deploy': {
      if (!existsSync(join(SRC, 'references'))) {
        fail(`ddd-workflow/ 目錄內容為空。`)
      }
      // 非 claude 平台需要 dist/（由 build.js 產生）
      const needs_dist = targets.some(t => t !== 'claude')
      if (needs_dist && !existsSync(DIST)) {
        fail('dist/ 目錄不存在。請先執行 `npm run build` 或使用 `npm run deploy`（會自動 build）。')
      }
      log(`來源: ${SRC} (subtree)`)
      log(`目標: ${targets.join(', ')}`)
      console.log('')
      deployConfig()
      console.log('')
      for (const t of targets) { deployers[t](); console.log('') }
      log('deploy 完成。請重啟各 agent CLI 以載入新設定。')
      break
    }

    case 'undeploy': {
      log(`目標: ${targets.join(', ')}`)
      console.log('')
      for (const t of targets) { undeployers[t](); console.log('') }
      log('undeploy 完成。')
      break
    }

    case 'test': {
      let all_ok = true
      for (const t of targets) {
        const ok = testers[t]()
        if (!ok) all_ok = false
        console.log('')
      }
      log(all_ok ? '全部通過 ✅' : '有項目未通過 ❌')
      process.exit(all_ok ? 0 : 1)
      break
    }

    default:
      fail(`未知指令: ${command}。執行 --help 查看用法。`)
  }
}

main()
