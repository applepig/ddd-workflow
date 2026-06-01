import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './shared/paths.js'

describe('Vite tooling entrypoints', () => {
  const vite_config = readFileSync(join(PROJECT_ROOT, 'vite.config.js'), 'utf8')

  it('builds publish init status and diff entrypoints', () => {
    expect(vite_config).toContain("'publish/init-publish'")
    expect(vite_config).toContain("src/tooling/publish/init-publish.js")
    expect(vite_config).toContain("'publish/status'")
    expect(vite_config).toContain("src/tooling/publish/status.js")
    expect(vite_config).toContain("'publish/diff'")
    expect(vite_config).toContain("src/tooling/publish/diff.js")
  })
})
