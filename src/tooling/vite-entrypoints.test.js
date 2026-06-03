import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './shared/paths.js'

describe('Vite tooling entrypoints', () => {
  const build_script = readFileSync(join(PROJECT_ROOT, 'scripts', 'build-tooling.js'), 'utf8')

  it('builds publish init status and diff entrypoints', () => {
    expect(build_script).toContain("'publish/init-publish'")
    expect(build_script).toContain("src/tooling/publish/init-publish.js")
    expect(build_script).toContain("'publish/status'")
    expect(build_script).toContain("src/tooling/publish/status.js")
    expect(build_script).toContain("'publish/diff'")
    expect(build_script).toContain("src/tooling/publish/diff.js")
  })
})
