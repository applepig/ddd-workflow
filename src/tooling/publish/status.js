#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUBLISH_ROOT } from '../shared/paths.js'

function fail(message) {
  console.error(`[publish:status] ${message}`)
  process.exit(1)
}

export function assertPublishCheckout({ publish_root = PUBLISH_ROOT } = {}) {
  if (!existsSync(join(publish_root, '.git'))) {
    throw new Error(`找不到 publish checkout：${publish_root}，請先執行 pnpm run publish:init`)
  }
}

export function runPublishGit(args, { publish_root = PUBLISH_ROOT } = {}) {
  assertPublishCheckout({ publish_root })

  const result = spawnSync('git', ['-C', publish_root, ...args], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || '無法讀取 publish repo 狀態')
  }

  return result.stdout
}

export function getPublishStatus({ publish_root = PUBLISH_ROOT } = {}) {
  return runPublishGit(['status', '--short', '--branch'], { publish_root }).trimEnd()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const status = getPublishStatus()
    if (status) {
      console.log(status)
    }
  } catch (err) {
    fail(err.message)
  }
}
