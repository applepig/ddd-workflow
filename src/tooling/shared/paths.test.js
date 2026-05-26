import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DIST_ROOT, PROJECT_ROOT, PUBLISH_ROOT, SOURCE_ROOT } from './paths.js'

describe('tooling paths', () => {
  it('resolves the authoring project root', () => {
    expect(existsSync(join(PROJECT_ROOT, 'package.json'))).toBe(true)
  })

  it('resolves source and publish roots under the authoring project', () => {
    expect(SOURCE_ROOT).toBe(join(PROJECT_ROOT, 'src', 'ddd-workflow'))
    expect(PUBLISH_ROOT).toBe(join(PROJECT_ROOT, '.publish', 'ddd-workflow'))
    expect(DIST_ROOT).toBe(join(PROJECT_ROOT, 'dist'))
  })
})
