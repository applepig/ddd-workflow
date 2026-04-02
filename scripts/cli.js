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
  renameSync, lstatSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'ddd-workflow')
const HOME = homedir()

const ALL_TARGETS = ['claude', 'gemini', 'codex', 'opencode']

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
 * 清理目標目錄中的 ddd* 項目，再為 ddd-workflow 中的子目錄建立 symlink。
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
    if (!statSync(src_path).isDirectory() && !name.endsWith('.md')) continue
    symlinkSync(src_path, join(target_dir, name))
    log(`  連結 ${label}: ${name}`)
  }
}

// ─── Deploy ──────────────────────────────────────────────────────────────────

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
  linkDir(join(SRC, 'agents'), join(target, 'agents'), 'agent')
}

function deployCodex() {
  log('=== codex ===')
  const target = join(HOME, '.codex')
  mkdirSync(target, { recursive: true })

  linkFile(join(SRC, 'references', 'AGENTS.md'), join(target, 'AGENTS.md'))
  linkDir(join(SRC, 'skills'), join(target, 'skills'), 'skill')
}

function deployOpencode() {
  log('=== opencode ===')
  const target = join(HOME, '.config', 'opencode')
  mkdirSync(target, { recursive: true })

  linkDir(join(SRC, 'skills'), join(target, 'skills'), 'skill')
  const agents_src = join(SRC, 'opencode', 'agents')
  if (existsSync(agents_src)) {
    linkDir(agents_src, join(target, 'agents'), 'agent')
  }
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
}

function undeployCodex() {
  log('=== codex ===')
  unlinkIfOurs(join(HOME, '.codex', 'AGENTS.md'), '~/.codex/AGENTS.md')
  unlinkDirIfOurs(join(HOME, '.codex', 'skills'))
}

function undeployOpencode() {
  log('=== opencode ===')
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
  countInstalledLinks(join(HOME, '.claude', 'agents'), '~/.claude/agents ddd*')
  if (!checkSymlink(join(HOME, '.claude', 'scripts', 'statusline.sh'), '~/.claude/scripts/statusline.sh')) ok = false

  return ok
}

function testGemini() {
  log('=== gemini 驗證 ===')
  let ok = true
  if (!checkSymlink(join(HOME, '.gemini', 'GEMINI.md'), '~/.gemini/GEMINI.md')) ok = false
  countInstalledLinks(join(HOME, '.gemini', 'skills'), '~/.gemini/skills ddd*')
  countInstalledLinks(join(HOME, '.gemini', 'agents'), '~/.gemini/agents ddd*')
  return ok
}

function testCodex() {
  log('=== codex 驗證 ===')
  let ok = true
  if (!checkSymlink(join(HOME, '.codex', 'AGENTS.md'), '~/.codex/AGENTS.md')) ok = false
  countInstalledLinks(join(HOME, '.codex', 'skills'), '~/.codex/skills ddd*')
  return ok
}

function testOpencode() {
  log('=== opencode 驗證 ===')
  const ok = true
  countInstalledLinks(join(HOME, '.config', 'opencode', 'skills'), '~/.config/opencode/skills ddd*')
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
      log(`來源: ${SRC} (subtree)`)
      log(`目標: ${targets.join(', ')}`)
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
