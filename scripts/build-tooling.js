import { build } from 'vite'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { builtinModules } from 'node:module'

const entries = {
  'bin/transpile-agents': 'src/tooling/bin/transpile-agents.js',
  'bin/deploy-agents': 'src/tooling/bin/deploy-agents.js',
  'publish/init-publish': 'src/tooling/publish/init-publish.js',
  'publish/build-publish': 'src/tooling/publish/build-publish.js',
  'publish/status': 'src/tooling/publish/status.js',
  'publish/diff': 'src/tooling/publish/diff.js',
  'deploy/deploy-local': 'src/tooling/deploy/deploy-local.js',
}

const external = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  'vite',
]

const out_dir_flag = process.argv.indexOf('--outDir')
const out_dir = out_dir_flag !== -1 ? process.argv[out_dir_flag + 1] : 'dist/tooling'

rmSync(out_dir, { recursive: true, force: true })

for (const [name, path] of Object.entries(entries)) {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: out_dir,
      emptyOutDir: false,
      target: 'node20',
      rollupOptions: {
        external,
        input: { [name]: resolve(path) },
        output: {
          format: 'es',
          banner: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
          entryFileNames: '[name].mjs',
        },
      },
    },
  })
}
