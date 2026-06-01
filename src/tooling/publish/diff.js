#!/usr/bin/env node

import { PUBLISH_ROOT } from '../shared/paths.js'
import { runPublishGit } from './status.js'

function fail(message) {
  console.error(`[publish:diff] ${message}`)
  process.exit(1)
}

export function getPublishDiff({ publish_root = PUBLISH_ROOT } = {}) {
  return runPublishGit(['diff', '--stat'], { publish_root }).trimEnd()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const diff = getPublishDiff()
    if (diff) {
      console.log(diff)
    }
  } catch (err) {
    fail(err.message)
  }
}
