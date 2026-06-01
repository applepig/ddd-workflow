#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PUBLISH_ROOT } from '../shared/paths.js'

const DEFAULT_REPO_URL = 'https://github.com/applepig/ddd-workflow'
const DEFAULT_BRANCH = 'publish/17-source-publish-workflow'
const DEFAULT_BASE_BRANCH = 'main'

function fail(message) {
  console.error(`[publish:init] ${message}`)
  process.exit(1)
}

function runGit(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

function parseArgs(argv) {
  const options = {
    repo_url: DEFAULT_REPO_URL,
    branch: DEFAULT_BRANCH,
    base_branch: DEFAULT_BASE_BRANCH,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--repo') {
      options.repo_url = argv[++i]
      continue
    }
    if (arg === '--branch') {
      options.branch = argv[++i]
      continue
    }
    if (arg === '--base') {
      options.base_branch = argv[++i]
    }
  }

  return options
}

function isEmptyDirectory(path) {
  if (!existsSync(path)) {
    return true
  }

  return readdirSync(path).length === 0
}

function ensureOriginRemote({ publish_root, repo_url }) {
  const remote_result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: publish_root,
    encoding: 'utf8',
  })

  if (remote_result.status === 0) {
    return
  }

  runGit(['remote', 'add', 'origin', repo_url], { cwd: publish_root })
}

function ensureBranch({ publish_root, branch }) {
  const current_branch = runGit(['branch', '--show-current'], { cwd: publish_root })
  if (current_branch === branch) {
    return
  }

  const branch_exists = spawnSync('git', ['rev-parse', '--verify', branch], {
    cwd: publish_root,
    encoding: 'utf8',
  })

  if (branch_exists.status === 0) {
    runGit(['checkout', branch], { cwd: publish_root })
    return
  }

  runGit(['checkout', '-B', branch], { cwd: publish_root })
}

export function initPublish({
  publish_root = PUBLISH_ROOT,
  repo_url = DEFAULT_REPO_URL,
  branch = DEFAULT_BRANCH,
  base_branch = DEFAULT_BASE_BRANCH,
  logger = console,
} = {}) {
  if (existsSync(join(publish_root, '.git'))) {
    ensureOriginRemote({ publish_root, repo_url })
    logger.log?.(`[publish:init] 已存在 managed checkout：${publish_root}`)
    return
  }

  if (existsSync(publish_root) && !isEmptyDirectory(publish_root)) {
    throw new Error(`${publish_root} 是非空目錄且不是 Git checkout，請先移走或手動處理`)
  }

  mkdirSync(dirname(publish_root), { recursive: true })
  runGit(['clone', '--branch', base_branch, repo_url, publish_root])
  ensureBranch({ publish_root, branch })
  logger.log?.(`[publish:init] 已初始化 ${publish_root}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    initPublish(parseArgs(process.argv.slice(2)))
  } catch (err) {
    fail(err.message)
  }
}
