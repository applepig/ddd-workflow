import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.{js,ts}', 'ddd-workflow/scripts/**/*.test.{js,ts}'],
  },
})
