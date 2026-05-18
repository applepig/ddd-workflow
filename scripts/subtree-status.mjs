#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const SUBTREE_PREFIX = 'ddd-workflow'
const SUBTREE_REMOTE = 'ddd-workflow'
const SUBTREE_BRANCH = 'dev'
const SUBTREE_REMOTE_REF = `refs/remotes/${SUBTREE_REMOTE}/${SUBTREE_BRANCH}`
const SKIP_ENV = 'AGENTS_SKIP_SUBTREE_CHECK'

const args = parseArgs(process.argv.slice(2))
const hook = args.hook ?? 'manual'
const push_remote = args.remote ?? null

const messages = []

function git(git_args, options = {}) {
  return execFileSync('git', git_args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', options.stderr ?? 'ignore'],
  }).trim()
}

function gitOk(git_args) {
  try {
    execFileSync('git', git_args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function emit(level, code, summary, recommendation, commands = [], block = false, meta = {}) {
  messages.push({
    source: 'agents-githook',
    hook,
    level,
    code,
    summary,
    recommendation,
    commands,
    block,
    ...meta,
  })
}

function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--hook') parsed.hook = argv[++i]
    if (arg === '--remote') parsed.remote = argv[++i]
  }
  return parsed
}

function getCurrentBranch() {
  try {
    return git(['branch', '--show-current']) || '(detached)'
  } catch {
    return '(unknown)'
  }
}

function hasRemote() {
  try {
    const remotes = git(['remote']).split('\n').filter(Boolean)
    return remotes.includes(SUBTREE_REMOTE)
  } catch {
    return false
  }
}

function getLastCommitFiles() {
  if (!gitOk(['rev-parse', '--verify', 'HEAD'])) return []
  try {
    return git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

function reportLastCommitShape() {
  if (hook !== 'post-commit') return

  const files = getLastCommitFiles()
  const subtree_files = files.filter((file) => file.startsWith(`${SUBTREE_PREFIX}/`))
  if (subtree_files.length === 0) return

  const parent_files = files.filter((file) => !file.startsWith(`${SUBTREE_PREFIX}/`))
  const commands = ['npm run subtree:status', 'npm run subtree:push']

  if (parent_files.length > 0) {
    emit(
      'warn',
      'SUBTREE_CROSS_REPO_COMMIT',
      '剛建立的 commit 同時修改 ddd-workflow subtree 與 parent repo 檔案。',
      '完成驗證後，先用 npm run subtree:push 發布 ddd-workflow prefix；parent glue changes 仍需用一般 git push 發布。',
      commands,
      false,
      { subtree_files: subtree_files.length, parent_files: parent_files.length },
    )
    return
  }

  emit(
    'warn',
    'SUBTREE_PUSH_RECOMMENDED',
    '剛建立的 commit 修改了 ddd-workflow subtree。',
    '完成驗證後，執行 npm run subtree:push，讓獨立 ddd-workflow repo 同步。',
    commands,
    false,
    { subtree_files: subtree_files.length },
  )
}

function reportSubtreeBranchRisk(branch) {
  if (!branch.startsWith('subtree/')) return

  emit(
    'error',
    'SUBTREE_SPLIT_BRANCH_DETECTED',
    `目前在 ${branch}，這通常是 subtree split 產物，不是 parent repo feature branch。`,
    '不要把 subtree/* branch merge 回 main/dev。若要整合 parent repo，請切回 dev 或 feature branch；若要發布 subtree，使用 npm run subtree:push。',
    ['git switch dev', 'npm run subtree:push'],
    hook === 'pre-push',
    { branch },
  )
}

function getSplitCommit() {
  return git(['subtree', 'split', `--prefix=${SUBTREE_PREFIX}`, 'HEAD'])
}

function reportSubtreeSync() {
  if (!existsSync(join(process.cwd(), SUBTREE_PREFIX))) {
    emit(
      'error',
      'SUBTREE_PREFIX_MISSING',
      `${SUBTREE_PREFIX}/ 目錄不存在。`,
      '確認目前在 AGENTS repo root，或檢查 subtree 是否被誤刪。',
      ['git status --short --branch'],
      hook === 'pre-push',
    )
    return
  }

  if (!hasRemote()) {
    emit(
      'error',
      'SUBTREE_REMOTE_MISSING',
      `找不到 ${SUBTREE_REMOTE} remote，無法判斷 subtree 是否同步。`,
      '新增 ddd-workflow remote 後再檢查同步狀態。',
      ['git remote add ddd-workflow git@github.com:applepig/ddd-workflow.git', 'npm run subtree:status'],
      hook === 'pre-push',
    )
    return
  }

  if (!gitOk(['rev-parse', '--verify', '--quiet', SUBTREE_REMOTE_REF])) {
    emit(
      'warn',
      'SUBTREE_REMOTE_REF_MISSING',
      `${SUBTREE_REMOTE_REF} 不存在或尚未 fetch。`,
      '先 fetch ddd-workflow remote，再重新檢查 subtree 狀態。',
      ['git fetch ddd-workflow', 'npm run subtree:status'],
      false,
    )
    return
  }

  let split_commit
  try {
    split_commit = getSplitCommit()
  } catch {
    emit(
      'error',
      'SUBTREE_SPLIT_FAILED',
      `無法計算 ${SUBTREE_PREFIX}/ 的 subtree split commit。`,
      '先確認 working tree 與 subtree history 狀態，再手動執行 git subtree split 除錯。',
      [`git subtree split --prefix=${SUBTREE_PREFIX} HEAD`],
      hook === 'pre-push',
    )
    return
  }

  const remote_commit = git(['rev-parse', SUBTREE_REMOTE_REF])
  const split_tree = git(['rev-parse', `${split_commit}^{tree}`])
  const remote_tree = git(['rev-parse', `${remote_commit}^{tree}`])
  if (split_commit === remote_commit) {
    emit(
      'info',
      'SUBTREE_CLEAN',
      `${SUBTREE_PREFIX}/ 已與 ${SUBTREE_REMOTE}/${SUBTREE_BRANCH} 同步。`,
      '不需要額外動作。',
      [],
      false,
      { split_commit, remote_commit },
    )
    return
  }

  if (split_tree === remote_tree) {
    emit(
      'info',
      'SUBTREE_CLEAN',
      `${SUBTREE_PREFIX}/ 內容已與 ${SUBTREE_REMOTE}/${SUBTREE_BRANCH} 同步，但 split commit history 不同。`,
      '不需要額外動作。下次有新的 ddd-workflow 變更時，再用 npm run subtree:push 或一般 ddd-workflow PR 流程同步。',
      [],
      false,
      { split_commit, remote_commit, split_tree, remote_tree },
    )
    return
  }

  const local_in_remote = gitOk(['merge-base', '--is-ancestor', split_commit, SUBTREE_REMOTE_REF])
  const remote_in_local = gitOk(['merge-base', '--is-ancestor', SUBTREE_REMOTE_REF, split_commit])

  if (remote_in_local) {
    emit(
      hook === 'pre-push' ? 'error' : 'warn',
      'SUBTREE_PUSH_REQUIRED',
      `${SUBTREE_PREFIX}/ 有尚未推送到 ${SUBTREE_REMOTE}/${SUBTREE_BRANCH} 的變更。`,
      '先執行 npm run subtree:push，再重新 push parent repo。',
      ['npm run subtree:push', 'git push'],
      hook === 'pre-push' && push_remote !== SUBTREE_REMOTE,
      { split_commit, remote_commit },
    )
    return
  }

  if (local_in_remote) {
    emit(
      'warn',
      'SUBTREE_PULL_AVAILABLE',
      `${SUBTREE_REMOTE}/${SUBTREE_BRANCH} 有本地 ${SUBTREE_PREFIX}/ 尚未包含的變更。`,
      '需要把獨立 ddd-workflow repo 的更新帶回 parent repo 時，執行 npm run subtree:pull。',
      ['npm run subtree:pull'],
      false,
      { split_commit, remote_commit },
    )
    return
  }

  emit(
    'error',
    'SUBTREE_DIVERGED',
    `${SUBTREE_PREFIX}/ 與 ${SUBTREE_REMOTE}/${SUBTREE_BRANCH} 已分歧。`,
    '先不要 push parent repo。請 fetch remote、檢查 diff，決定要 subtree pull、重新 split，或手動整理 history。',
    ['git fetch ddd-workflow', 'npm run subtree:status', 'git log --oneline --graph --decorate --all -30'],
    hook === 'pre-push' && push_remote !== SUBTREE_REMOTE,
    { split_commit, remote_commit },
  )
}

function main() {
  const branch = getCurrentBranch()
  reportSubtreeBranchRisk(branch)
  reportLastCommitShape()
  reportSubtreeSync()

  for (const message of messages) {
    process.stderr.write(`${JSON.stringify(message)}\n`)
  }

  const should_block = messages.some((message) => message.block)
  if (should_block && process.env[SKIP_ENV] !== '1') {
    process.exit(1)
  }
}

main()
