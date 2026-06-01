import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const external = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  'vite',
]

export default defineConfig({
  build: {
    outDir: 'dist/tooling',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: {
      external,
      input: {
        'bin/transpile-agents': resolve('src/tooling/bin/transpile-agents.js'),
        'bin/deploy-agents': resolve('src/tooling/bin/deploy-agents.js'),
        'publish/init-publish': resolve('src/tooling/publish/init-publish.js'),
        'publish/build-publish': resolve('src/tooling/publish/build-publish.js'),
        'publish/status': resolve('src/tooling/publish/status.js'),
        'publish/diff': resolve('src/tooling/publish/diff.js'),
        'deploy/deploy-local': resolve('src/tooling/deploy/deploy-local.js'),
      },
      output: {
        format: 'es',
        banner: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
        entryFileNames: '[name].mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
      },
    },
  },
})
