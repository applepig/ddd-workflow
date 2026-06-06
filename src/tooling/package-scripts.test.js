import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './shared/paths.js'

describe('package scripts', () => {
  const package_json = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'))

  it('uses pnpm and Vitest as the main test entrypoint', () => {
    expect(package_json.packageManager).toMatch(/^pnpm@/)
    expect(package_json.devDependencies.skills).toBeDefined()
    expect(package_json.scripts.test).toBe('DDD_WORKFLOW_TEST_SCOPE=typical vitest run')
    expect(package_json.scripts['test:preflight']).toBe('DDD_WORKFLOW_TEST_SCOPE=preflight vitest run')
    expect(package_json.scripts['test:full']).toContain('DDD_WORKFLOW_TEST_SCOPE=full')
    expect(package_json.scripts['test:full']).toContain('DDD_WORKFLOW_FULL_SHELL_TESTS=1')
  })

  it('routes build and deploy through Vite tooling dist entrypoints', () => {
    expect(package_json.scripts['build:tooling']).toBe('node scripts/build-tooling.js')
    expect(package_json.scripts['publish:init']).toBe('pnpm run build:tooling && node dist/tooling/publish/init-publish.mjs')
    expect(package_json.scripts.build).toContain('dist/tooling/publish/build-publish.mjs')
    expect(package_json.scripts['publish:status']).toBe('node dist/tooling/publish/status.mjs')
    expect(package_json.scripts['publish:diff']).toBe('node dist/tooling/publish/diff.mjs')
    expect(package_json.scripts['publish:refresh']).toBe('pnpm run build:tooling && node dist/tooling/publish/build-publish.mjs --force')
    expect(package_json.scripts['test:pack']).toContain('./.publish/ddd-workflow')
    expect(package_json.scripts['test:pack']).toMatch(/^skills add /)
    expect(package_json.scripts['test:pack']).not.toContain('npx')
    expect(package_json.scripts.deploy).toContain('pnpm run test:preflight')
    expect(package_json.scripts.deploy).toContain('dist/tooling/deploy/deploy-local.mjs')
    expect(package_json.scripts['deploy:dry-run']).toContain('--dry-run')
    expect(package_json.scripts['deploy:check']).toContain('--home-dir /tmp/ddd-workflow-deploy-check --skip-skills')
  })

  it('does not expose legacy subtree package scripts', () => {
    expect(Object.keys(package_json.scripts).some((name) => name.startsWith('subtree:'))).toBe(false)
  })
})
