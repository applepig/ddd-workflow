import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { computeSourceTreeHash } from './build-manifest.js'

/**
 * 讀取 build manifest（.publish/ddd-workflow/.build-manifest.json）。
 * 不存在則 throw。
 */
export function readBuildManifest(publish_root) {
  const manifest_path = join(publish_root, '.build-manifest.json')

  if (!existsSync(manifest_path)) {
    throw new Error(`Build manifest not found: ${manifest_path}. Run pnpm run build first.`)
  }

  return JSON.parse(readFileSync(manifest_path, 'utf8'))
}

/**
 * 讀取 deploy manifest JSON。檔案不存在回傳 null。
 */
export function readDeployManifest(deploy_manifest_path) {
  if (!existsSync(deploy_manifest_path)) {
    return null
  }

  return JSON.parse(readFileSync(deploy_manifest_path, 'utf8'))
}

/**
 * 比對 build manifest 與 deploy manifest，回傳 action list。
 *
 * @param {object} build_manifest - build manifest 物件
 * @param {object|null} deploy_manifest - deploy manifest 物件，null 表示全部都是 new
 * @param {object} options
 * @param {(unit_key: string) => boolean} options.checkTargetExists - 判斷 copy-if-missing target 是否存在
 * @returns {Array<{unit: string, action: string, reason: string}>}
 */
export function diffManifests(build_manifest, deploy_manifest, { checkTargetExists }) {
  const diff = []
  const build_units = build_manifest.units
  const deploy_units = deploy_manifest?.units || {}

  // 處理 build manifest 中的所有 units
  for (const unit_key of Object.keys(build_units)) {
    const build_entry = build_units[unit_key]

    // copy-if-missing 且 target 存在 → 無條件 skip
    if (build_entry.strategy === 'copy-if-missing' && checkTargetExists(unit_key)) {
      diff.push({ unit: unit_key, action: 'skip', reason: 'copy-if-missing, target exists' })
      continue
    }

    const deploy_entry = deploy_units[unit_key]

    if (!deploy_entry) {
      diff.push({ unit: unit_key, action: 'install', reason: 'new unit' })
      continue
    }

    if (build_entry.hash === deploy_entry.hash) {
      diff.push({ unit: unit_key, action: 'skip', reason: 'unchanged' })
      continue
    }

    diff.push({ unit: unit_key, action: 'install', reason: 'hash changed' })
  }

  // 處理 deploy manifest 中有但 build 沒有的 units（orphaned）
  for (const unit_key of Object.keys(deploy_units)) {
    if (!build_units[unit_key]) {
      diff.push({ unit: unit_key, action: 'remove', reason: 'orphaned' })
    }
  }

  return diff
}

/**
 * 寫入 deploy manifest JSON，自動建立目錄。
 */
export function writeDeployManifest(deploy_manifest_path, manifest) {
  mkdirSync(dirname(deploy_manifest_path), { recursive: true })
  writeFileSync(deploy_manifest_path, JSON.stringify(manifest, null, 2))
}

/**
 * 組裝 deploy manifest 物件。
 *
 * @param {object} options
 * @param {string} options.deploy_from - publish root 路徑
 * @param {object} options.units - 已部署的 units 物件（含 hash、target、skipped）
 * @returns {object} deploy manifest
 */
export function buildDeployManifest({ deploy_from, units }) {
  return {
    version: 1,
    deployedFrom: deploy_from,
    deployedAt: new Date().toISOString(),
    units,
  }
}

/**
 * 檢查 source tree 是否在 build 後有變更。
 * 不一致則 throw，提示重新 build。
 */
export async function checkStaleBuild({ source_root, build_manifest }) {
  const current_hash = await computeSourceTreeHash(source_root)

  if (current_hash !== build_manifest.sourceTreeHash) {
    throw new Error(
      `Build is stale: source tree has changed since last build. Run \`pnpm run build\` to rebuild.`
    )
  }
}
