import { defineConfig } from 'vitest/config'

const TEST_SCOPE = process.env.DDD_WORKFLOW_TEST_SCOPE || 'typical'

const include = TEST_SCOPE === 'preflight'
  ? [
      'src/tooling/package-scripts.test.js',
      'src/tooling/shared/**/*.test.{js,ts}',
      'src/tooling/vite-entrypoints.test.js',
      'src/tooling/manifest/**/*.test.{js,ts}',
      'src/tooling/deploy/**/*.test.{js,ts}',
      'src/tooling/publish/build-publish.test.js',
    ]
  : ['src/**/*.test.{js,ts}', 'tests/**/*.test.{js,ts}']

const exclude = TEST_SCOPE === 'typical'
  ? ['tests/ddd-workflow/shell-tests.test.js']
  : []

export default defineConfig({
  test: {
    include,
    exclude,
  },
})
