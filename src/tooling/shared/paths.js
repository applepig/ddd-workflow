import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const SOURCE_ROOT = join(PROJECT_ROOT, 'src', 'ddd-workflow')
export const PUBLISH_ROOT = join(PROJECT_ROOT, '.publish', 'ddd-workflow')
export const DIST_ROOT = join(PROJECT_ROOT, 'dist')
export const TOOLING_DIST_ROOT = join(DIST_ROOT, 'tooling')
