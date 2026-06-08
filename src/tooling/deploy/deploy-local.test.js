import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { PROJECT_ROOT } from '../shared/paths.js'
import {
  applyDeployActions,
  checkTargetExistsForUnit,
  parseArgs,
  planClaudeDeploy,
  planDeploy,
  planSkillsInstall,
  planRuntimeDeploy,
  resolveDeployManifestPath,
  resolveUnitTarget,
  runManifestAwareDeploy,
} from './deploy-local.js'
import { generateBuildManifest } from '../manifest/build-manifest.js'

function mkdtempLike(prefix) {
  const result = spawnSync('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function writeFile(path, content) {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true })
  writeFileSync(path, content)
}

function writePublishFixture(publish_root) {
  writeFile(join(publish_root, 'references', 'AGENTS.md'), 'instructions\n')
  writeFile(join(publish_root, 'agents', 'ddd-developer.md'), 'claude developer\n')
  writeFile(join(publish_root, 'agents', 'ddd-reviewer.md'), 'claude reviewer\n')
  writeFile(join(publish_root, 'dist', 'gemini', 'agents', 'ddd-developer.md'), 'gemini developer\n')
  writeFile(join(publish_root, 'dist', 'codex', 'agents', 'ddd-developer.toml'), 'codex developer\n')
  writeFile(join(publish_root, 'dist', 'opencode', 'agents', 'ddd-developer.md'), 'opencode developer\n')
  writeFile(join(publish_root, 'policies', 'ddd.xreview.toml'), 'policy\n')
  writeFile(join(publish_root, 'config', 'xreview.json'), '{"reviewers":[]}\n')
  writeFile(join(publish_root, 'config', 'opencode-tui.json'), '{}\n')
  writeFile(join(publish_root, 'scripts', 'claude', 'statusline.sh'), '#!/bin/sh\n')
  writeFile(join(publish_root, 'scripts', 'shared', 'session-trigger.mjs'), 'console.log("tick")\n')
  writeFile(join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-capture.js'), 'capture\n')
  writeFile(join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-status.tsx'), 'status\n')
  writeFile(join(publish_root, 'scripts', 'opencode', 'opencode-codex-usage-format.js'), 'format\n')
}

function installFakeCrontab(tmp_dir, initial_crontab = '') {
  const bin_dir = join(tmp_dir, 'bin')
  const crontab_path = join(tmp_dir, 'crontab.txt')
  mkdirSync(bin_dir, { recursive: true })
  writeFileSync(crontab_path, initial_crontab)
  writeFileSync(join(bin_dir, 'crontab'), `#!/bin/sh
set -eu
if [ "\${1:-}" = "-l" ]; then
  cat "${crontab_path}"
  exit 0
fi
cat > "${crontab_path}"
`)
  chmodSync(join(bin_dir, 'crontab'), 0o755)
  return { bin_dir, crontab_path }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function withPath(path_value, callback) {
  const original_path = process.env.PATH
  process.env.PATH = path_value
  try {
    return callback()
  } finally {
    process.env.PATH = original_path
  }
}

describe('deploy-local fake HOME integration', () => {
  let tmp_dir
  let publish_root
  let home_dir
  let original_path

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'deploy-local-integration-'))
    publish_root = join(tmp_dir, 'publish')
    home_dir = join(tmp_dir, 'home')
    writePublishFixture(publish_root)
    const { bin_dir } = installFakeCrontab(tmp_dir)
    original_path = process.env.PATH
    process.env.PATH = `${bin_dir}:${original_path}`
  })

  afterEach(() => {
    process.env.PATH = original_path
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('applies non-skill deploy actions into a /tmp fake HOME without symlinks', () => {
    const actions = planDeploy({
      publish_root,
      home_dir,
      include_skills: false,
    })

    applyDeployActions(actions, { logger: { log() {} } })

    expect(readFileSync(join(home_dir, '.claude', 'CLAUDE.md'), 'utf8')).toBe('instructions\n')
    expect(readFileSync(join(home_dir, '.gemini', 'agents', 'ddd-developer.md'), 'utf8')).toBe('gemini developer\n')
    expect(readFileSync(join(home_dir, '.codex', 'agents', 'ddd-developer.toml'), 'utf8')).toBe('codex developer\n')
    expect(readFileSync(join(home_dir, '.config', 'opencode', 'agents', 'ddd-developer.md'), 'utf8')).toBe('opencode developer\n')
    expect(readFileSync(join(home_dir, '.config', 'ddd-workflow', 'runtime', 'shared', 'session-trigger.mjs'), 'utf8')).toContain('tick')

    const symlink_scan = spawnSync('find', [home_dir, '-type', 'l'], { encoding: 'utf-8' })
    expect(symlink_scan.stdout).toBe('')
  })

  it('preserves existing user-editable xreview config', () => {
    const config_path = join(home_dir, '.config', 'ddd-workflow', 'xreview.json')
    writeFile(config_path, '{"reviewers":["custom"]}\n')

    const actions = planDeploy({
      publish_root,
      home_dir,
      include_skills: false,
    })

    applyDeployActions(actions, { logger: { log() {} } })

    expect(readFileSync(config_path, 'utf8')).toBe('{"reviewers":["custom"]}\n')
  })

  it('preserves existing user OpenCode TUI config', () => {
    const config_path = join(home_dir, '.config', 'opencode', 'tui.json')
    writeFile(config_path, '{"theme":"custom"}\n')

    const actions = planDeploy({
      publish_root,
      home_dir,
      include_skills: false,
      targets: ['opencode'],
    })

    applyDeployActions(actions, { logger: { log() {} } })

    expect(readFileSync(config_path, 'utf8')).toBe('{"theme":"custom"}\n')
  })

  it('does not write to fake HOME during dry-run', () => {
    const actions = planDeploy({
      publish_root,
      home_dir,
      include_skills: false,
    })

    applyDeployActions(actions, { dry_run: true, logger: { log() {} } })

    expect(existsSync(home_dir)).toBe(false)
  })
})

describe('session-trigger crontab deploy', () => {
  let tmp_dir
  let home_dir
  let publish_root

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'session-trigger-cron-'))
    home_dir = join(tmp_dir, 'home')
    publish_root = join(tmp_dir, 'publish')
    writePublishFixture(publish_root)
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should plan a managed crontab action for the deployed runtime script', () => {
    const actions = planRuntimeDeploy({ publish_root, home_dir })

    expect(actions).toContainEqual({
      type: 'crontab',
      label: 'install session-trigger crontab',
      script: join(home_dir, '.config', 'ddd-workflow', 'runtime', 'shared', 'session-trigger.mjs'),
    })
  })

  it('should install managed session-trigger block through crontab', () => {
    const { bin_dir, crontab_path } = installFakeCrontab(tmp_dir, 'MAILTO=""\n')
    const actions = planRuntimeDeploy({ publish_root, home_dir })

    withPath(`${bin_dir}:${process.env.PATH}`, () => {
      applyDeployActions(actions, { logger: { log() {} } })
    })

    const crontab = readFileSync(crontab_path, 'utf8')
    expect(crontab).toContain('MAILTO=""\n')
    expect(crontab).toContain('# BEGIN AGENTS session-trigger')
    expect(crontab).toContain(`0 7,12,17 * * 1-5 PATH=${home_dir}/.opencode/bin:${home_dir}/.local/bin:/usr/local/bin:/usr/bin:/bin ${join(home_dir, '.config', 'ddd-workflow', 'runtime', 'shared', 'session-trigger.mjs')} >/dev/null 2>&1`)
    expect(crontab).toContain('# END AGENTS session-trigger')
  })

  it('should not modify crontab during dry-run', () => {
    const { bin_dir, crontab_path } = installFakeCrontab(tmp_dir, 'MAILTO=""\n')
    const actions = planRuntimeDeploy({ publish_root, home_dir })

    withPath(`${bin_dir}:${process.env.PATH}`, () => {
      applyDeployActions(actions, { dry_run: true, logger: { log() {} } })
    })

    expect(readFileSync(crontab_path, 'utf8')).toBe('MAILTO=""\n')
  })

  it('should replace unmanaged session-trigger lines with one managed block', () => {
    const old_line = '0 8 * * * /old/path/session-trigger.mjs >/dev/null 2>&1\n'
    const { bin_dir, crontab_path } = installFakeCrontab(tmp_dir, `MAILTO=""\n${old_line}`)
    const actions = planRuntimeDeploy({ publish_root, home_dir })

    withPath(`${bin_dir}:${process.env.PATH}`, () => {
      applyDeployActions(actions, { logger: { log() {} } })
    })

    const crontab = readFileSync(crontab_path, 'utf8')
    expect(crontab).not.toContain(old_line)
    expect(crontab.match(/BEGIN AGENTS session-trigger/g)).toHaveLength(1)
  })

  it('should skip writing when the managed crontab block is already correct', () => {
    const script = join(home_dir, '.config', 'ddd-workflow', 'runtime', 'shared', 'session-trigger.mjs')
    const managed_block = [
      '# BEGIN AGENTS session-trigger',
      `0 7,12,17 * * 1-5 PATH=${home_dir}/.opencode/bin:${home_dir}/.local/bin:/usr/local/bin:/usr/bin:/bin ${script} >/dev/null 2>&1`,
      '# END AGENTS session-trigger',
      '',
    ].join('\n')
    const { bin_dir, crontab_path } = installFakeCrontab(tmp_dir, managed_block)
    const actions = planRuntimeDeploy({ publish_root, home_dir })
    const log_messages = []

    withPath(`${bin_dir}:${process.env.PATH}`, () => {
      applyDeployActions(actions, { logger: { log: (msg) => log_messages.push(msg) } })
    })

    expect(readFileSync(crontab_path, 'utf8')).toBe(managed_block)
    expect(log_messages.some((msg) => msg.includes('already installed'))).toBe(true)
  })
})

describe('Claude statusLine settings deploy', () => {
  let tmp_dir
  let publish_root
  let home_dir
  const expected_status_line = {
    type: 'command',
    command: 'bash "$HOME/.claude/scripts/statusline.sh"',
  }

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'claude-settings-'))
    publish_root = join(tmp_dir, 'publish')
    home_dir = join(tmp_dir, 'home')
    writePublishFixture(publish_root)
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should plan Claude settings with the statusLine command in the Claude target scope', () => {
    const actions = planClaudeDeploy({ publish_root, home_dir })

    expect(actions).toContainEqual({
      type: 'claude-settings',
      unit: 'setting:claude:statusLine',
      target: join(home_dir, '.claude', 'settings.json'),
      statusLine: expected_status_line,
    })
  })

  it('should write statusLine and preserve other settings fields by default', () => {
    const settings_path = join(home_dir, '.claude', 'settings.json')
    writeFile(settings_path, JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash'] } }, null, 2))

    applyDeployActions(planClaudeDeploy({ publish_root, home_dir }), { logger: { log() {} } })

    expect(readJson(settings_path)).toEqual({
      theme: 'dark',
      permissions: { allow: ['Bash'] },
      statusLine: expected_status_line,
    })
  })

  it('should not write Claude settings during dry-run', () => {
    const settings_path = join(home_dir, '.claude', 'settings.json')

    applyDeployActions(planClaudeDeploy({ publish_root, home_dir }), { dry_run: true, logger: { log() {} } })

    expect(existsSync(settings_path)).toBe(false)
  })

  it('should log skip when Claude statusLine is already correct', () => {
    const settings_path = join(home_dir, '.claude', 'settings.json')
    const log_messages = []
    writeFile(settings_path, JSON.stringify({ statusLine: expected_status_line }, null, 2))

    applyDeployActions(planClaudeDeploy({ publish_root, home_dir }), {
      logger: { log: (msg) => log_messages.push(msg) },
    })

    expect(readJson(settings_path).statusLine).toEqual(expected_status_line)
    expect(log_messages.some((msg) => msg.includes('already correct'))).toBe(true)
  })

  it('should skip conflicting statusLine when interactive settings does not confirm overwrite', () => {
    const settings_path = join(home_dir, '.claude', 'settings.json')
    const existing_status_line = { type: 'command', command: 'custom-statusline' }
    writeFile(settings_path, JSON.stringify({ statusLine: existing_status_line, theme: 'dark' }, null, 2))

    applyDeployActions(planClaudeDeploy({ publish_root, home_dir }), {
      logger: { log() {} },
      interactive_settings: { confirm: () => false },
    })

    expect(readJson(settings_path)).toEqual({ statusLine: existing_status_line, theme: 'dark' })
  })

  it('should overwrite conflicting statusLine when interactive settings confirms overwrite', () => {
    const settings_path = join(home_dir, '.claude', 'settings.json')
    writeFile(settings_path, JSON.stringify({ statusLine: { type: 'command', command: 'custom' }, theme: 'dark' }, null, 2))

    applyDeployActions(planClaudeDeploy({ publish_root, home_dir }), {
      logger: { log() {} },
      interactive_settings: { confirm: () => true },
    })

    expect(readJson(settings_path)).toEqual({ theme: 'dark', statusLine: expected_status_line })
  })
})

describe('deploy-local CLI args', () => {
  it('supports fake HOME and skipping skills for isolated checks', () => {
    expect(parseArgs(['--home-dir', '/tmp/ddd-home', '--skip-skills', 'claude'])).toEqual({
      dry_run: false,
      home_dir: '/tmp/ddd-home',
      include_skills: false,
      targets: ['claude'],
    })
  })
})

describe('planSkillsInstall', () => {
  it('should install skills through an available skills CLI with npx fallback', () => {
    const action = planSkillsInstall({ publish_root: '/publish' })

    expect(action.command).toBe('sh')
    expect(action.cwd).toBe(PROJECT_ROOT)
    expect(action.args[0]).toBe('-c')
    expect(action.args[1]).toContain('command -v skills')
    expect(action.args[1]).toContain('skills "$@"')
    expect(action.args[1]).toContain('npx -y skills "$@"')
    expect(action.args.slice(3)).toEqual([
      'add',
      '/publish',
      '--skill',
      '*',
      '-g',
      '-y',
      '-a',
      'claude-code',
      '-a',
      'opencode',
      '-a',
      'codex',
      '-a',
      'gemini-cli',
    ])
  })

  it('should prefer installed skills CLI over npx fallback', () => {
    const tmp_dir = mkdtempLike(join(tmpdir(), 'skills-install-prefer-'))
    const bin_dir = join(tmp_dir, 'bin')
    const calls_path = join(tmp_dir, 'calls.txt')
    mkdirSync(bin_dir, { recursive: true })
    writeFileSync(join(bin_dir, 'skills'), `#!/bin/sh
printf 'skills:%s\n' "$*" >> "${calls_path}"
`)
    writeFileSync(join(bin_dir, 'npx'), `#!/bin/sh
printf 'npx:%s\n' "$*" >> "${calls_path}"
`)
    chmodSync(join(bin_dir, 'skills'), 0o755)
    chmodSync(join(bin_dir, 'npx'), 0o755)

    try {
      const action = planSkillsInstall({ publish_root: '/publish' })
      const result = withPath(`${bin_dir}:/usr/bin:/bin`, () => spawnSync(action.command, action.args, { encoding: 'utf-8' }))

      expect(result.status).toBe(0)
      expect(readFileSync(calls_path, 'utf8')).toBe('skills:add /publish --skill * -g -y -a claude-code -a opencode -a codex -a gemini-cli\n')
    } finally {
      rmSync(tmp_dir, { recursive: true, force: true })
    }
  })

  it('should fall back to npx -y when skills CLI is unavailable', () => {
    const tmp_dir = mkdtempLike(join(tmpdir(), 'skills-install-fallback-'))
    const bin_dir = join(tmp_dir, 'bin')
    const calls_path = join(tmp_dir, 'calls.txt')
    mkdirSync(bin_dir, { recursive: true })
    writeFileSync(join(bin_dir, 'npx'), `#!/bin/sh
printf 'npx:%s\n' "$*" >> "${calls_path}"
`)
    chmodSync(join(bin_dir, 'npx'), 0o755)

    try {
      const action = planSkillsInstall({ publish_root: '/publish' })
      const result = withPath(`${bin_dir}:/usr/bin:/bin`, () => spawnSync(action.command, action.args, { encoding: 'utf-8' }))

      expect(result.status).toBe(0)
      expect(readFileSync(calls_path, 'utf8')).toBe('npx:-y skills add /publish --skill * -g -y -a claude-code -a opencode -a codex -a gemini-cli\n')
    } finally {
      rmSync(tmp_dir, { recursive: true, force: true })
    }
  })
})

describe('resolveDeployManifestPath', () => {
  it('should return path under .config/ddd-workflow/deploy.json', () => {
    const result = resolveDeployManifestPath('/home/testuser')
    expect(result).toBe('/home/testuser/.config/ddd-workflow/deploy.json')
  })
})

describe('resolveUnitTarget', () => {
  it('should return skills-cli for skill units', () => {
    const result = resolveUnitTarget('skill:ddd.work', [])
    expect(result).toBe('skills-cli')
  })

  it('should return the target path from matching action for non-skill units', () => {
    const actions = [
      {
        type: 'copy',
        unit: 'agent:claude:ddd-developer',
        source: '/publish/agents/ddd-developer.md',
        target: '/home/.claude/agents/ddd-developer.md',
        mode: 'overwrite-generated',
      },
    ]

    const result = resolveUnitTarget('agent:claude:ddd-developer', actions)
    expect(result).toBe('/home/.claude/agents/ddd-developer.md')
  })

  it('should use precise unit mapping when multiple platforms have the same agent name', () => {
    const actions = planDeploy({
      publish_root: '/publish',
      home_dir: '/home',
      include_skills: false,
      targets: ['claude', 'gemini', 'opencode', 'codex'],
    })

    expect(resolveUnitTarget('agent:claude:ddd-developer', actions))
      .toBe('/home/.claude/agents/ddd-developer.md')
    expect(resolveUnitTarget('agent:gemini:ddd-developer', actions))
      .toBe('/home/.gemini/agents/ddd-developer.md')
    expect(resolveUnitTarget('agent:opencode:ddd-developer', actions))
      .toBe('/home/.config/opencode/agents/ddd-developer.md')
    expect(resolveUnitTarget('agent:codex:ddd-developer', actions))
      .toBe('/home/.codex/agents/ddd-developer.toml')
  })

  it('should return null when no matching action found', () => {
    const result = resolveUnitTarget('agent:claude:unknown', [])
    expect(result).toBeNull()
  })
})

describe('checkTargetExistsForUnit', () => {
  let tmp_dir

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'target-exists-'))
  })

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should return true when config:xreview target exists', () => {
    const config_path = join(tmp_dir, '.config', 'ddd-workflow', 'xreview.json')
    writeFile(config_path, '{}')

    expect(checkTargetExistsForUnit('config:xreview', tmp_dir)).toBe(true)
  })

  it('should return true when config:opencode-tui target exists', () => {
    const config_path = join(tmp_dir, '.config', 'opencode', 'tui.json')
    writeFile(config_path, '{}')

    expect(checkTargetExistsForUnit('config:opencode-tui', tmp_dir)).toBe(true)
  })

  it('should return false when config:xreview target does not exist', () => {
    expect(checkTargetExistsForUnit('config:xreview', tmp_dir)).toBe(false)
  })

  it('should return false for unknown unit keys', () => {
    expect(checkTargetExistsForUnit('skill:ddd.work', tmp_dir)).toBe(false)
  })
})

describe('manifest-aware deploy integration', () => {
  let tmp_dir
  let publish_root
  let home_dir
  let source_root
  let crontab_path
  let original_path

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'manifest-deploy-'))
    publish_root = join(tmp_dir, 'publish')
    home_dir = join(tmp_dir, 'home')
    source_root = join(tmp_dir, 'src', 'ddd-workflow')

    writePublishFixture(publish_root)
    const fake_crontab = installFakeCrontab(tmp_dir)
    crontab_path = fake_crontab.crontab_path
    original_path = process.env.PATH
    process.env.PATH = `${fake_crontab.bin_dir}:${original_path}`

    // Build a minimal source tree for stale-build check
    mkdirSync(join(source_root, 'skills', 'ddd.work'), { recursive: true })
    writeFileSync(join(source_root, 'skills', 'ddd.work', 'SKILL.md'), '# skill content')
  })

  afterEach(() => {
    process.env.PATH = original_path
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('should reject stale build when source hash differs', async () => {
    // Write a build manifest with a stale hash
    const build_manifest = {
      version: 1,
      sourceTreeHash: 'stale-hash-not-matching',
      buildTime: '2025-01-01T00:00:00.000Z',
      units: { 'skill:ddd.work': { hash: 'abc' } },
    }
    writeFile(
      join(publish_root, '.build-manifest.json'),
      JSON.stringify(build_manifest),
    )

    await expect(
      runManifestAwareDeploy({
        publish_root,
        home_dir,
        source_root,
        include_skills: false,
        targets: ['claude'],
        dry_run: false,
        logger: { log() {} },
      })
    ).rejects.toThrow(/pnpm run build/)
  })

  it('should not write deploy manifest during dry-run', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: { 'reference:AGENTS.md': { hash: 'abc' } },
    }
    writeFile(
      join(publish_root, '.build-manifest.json'),
      JSON.stringify(build_manifest),
    )

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: true,
      logger: { log() {} },
    })

    const deploy_manifest_path = resolveDeployManifestPath(home_dir)
    expect(existsSync(deploy_manifest_path)).toBe(false)
  })

  it('should write deploy manifest after successful deploy', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {
        'reference:AGENTS.md': { hash: 'ref-hash' },
        'agent:claude:ddd-developer': { hash: 'agent-hash' },
      },
    }
    writeFile(
      join(publish_root, '.build-manifest.json'),
      JSON.stringify(build_manifest),
    )

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    const deploy_manifest_path = resolveDeployManifestPath(home_dir)
    expect(existsSync(deploy_manifest_path)).toBe(true)

    const deploy_manifest = JSON.parse(readFileSync(deploy_manifest_path, 'utf8'))
    expect(deploy_manifest.version).toBe(1)
    expect(deploy_manifest.deployedFrom).toBe(publish_root)
    expect(deploy_manifest.deployedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(deploy_manifest.units['reference:AGENTS.md']).toBeDefined()
    expect(deploy_manifest.units['reference:AGENTS.md'].hash).toBe('ref-hash')
    expect(deploy_manifest.units['agent:claude:ddd-developer']).toBeDefined()
    expect(deploy_manifest.units['agent:claude:ddd-developer'].hash).toBe('agent-hash')
  })

  it('should install session-trigger crontab during manifest-aware deploy', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {
        'script:shared:session-trigger.mjs': { hash: 'script-hash' },
      },
    }
    writeFile(join(publish_root, '.build-manifest.json'), JSON.stringify(build_manifest))

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    expect(readFileSync(crontab_path, 'utf8')).toContain('# BEGIN AGENTS session-trigger')
  })

  it('should ensure session-trigger crontab even when runtime script is unchanged', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)
    const script_hash = 'script-hash'

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {
        'script:shared:session-trigger.mjs': { hash: script_hash },
      },
    }
    writeFile(join(publish_root, '.build-manifest.json'), JSON.stringify(build_manifest))
    writeFile(join(home_dir, '.config', 'ddd-workflow', 'deploy.json'), JSON.stringify({
      version: 1,
      deployedFrom: publish_root,
      deployedAt: '2025-01-01T00:00:00.000Z',
      units: {
        'script:shared:session-trigger.mjs': {
          hash: script_hash,
          target: join(home_dir, '.config', 'ddd-workflow', 'runtime', 'shared', 'session-trigger.mjs'),
        },
      },
    }))

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    expect(readFileSync(crontab_path, 'utf8')).toContain('# BEGIN AGENTS session-trigger')
  })

  it('should ensure Claude settings even when statusline script is unchanged', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)
    const script_hash = 'script-hash'

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {
        'script:claude:statusline.sh': { hash: script_hash },
      },
    }
    writeFile(join(publish_root, '.build-manifest.json'), JSON.stringify(build_manifest))
    writeFile(join(home_dir, '.config', 'ddd-workflow', 'deploy.json'), JSON.stringify({
      version: 1,
      deployedFrom: publish_root,
      deployedAt: '2025-01-01T00:00:00.000Z',
      units: {
        'script:claude:statusline.sh': {
          hash: script_hash,
          target: join(home_dir, '.claude', 'scripts', 'statusline.sh'),
        },
      },
    }))

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    expect(readJson(join(home_dir, '.claude', 'settings.json')).statusLine).toEqual({
      type: 'command',
      command: 'bash "$HOME/.claude/scripts/statusline.sh"',
    })
  })

  it('should only record units installed for the selected target', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {
        'reference:AGENTS.md': { hash: 'ref-hash' },
        'agent:claude:ddd-developer': { hash: 'claude-hash' },
        'agent:gemini:ddd-developer': { hash: 'gemini-hash' },
        'agent:opencode:ddd-developer': { hash: 'opencode-hash' },
        'agent:codex:ddd-developer': { hash: 'codex-hash' },
      },
    }
    writeFile(join(publish_root, '.build-manifest.json'), JSON.stringify(build_manifest))

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    const deploy_manifest = JSON.parse(readFileSync(resolveDeployManifestPath(home_dir), 'utf8'))
    expect(Object.keys(deploy_manifest.units)).toEqual(expect.arrayContaining([
      'reference:AGENTS.md',
      'agent:claude:ddd-developer',
    ]))
    expect(deploy_manifest.units['agent:gemini:ddd-developer']).toBeUndefined()
    expect(deploy_manifest.units['agent:opencode:ddd-developer']).toBeUndefined()
    expect(deploy_manifest.units['agent:codex:ddd-developer']).toBeUndefined()
  })

  it('should ignore out-of-scope platform units when detecting second scoped deploy changes', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {
        'reference:AGENTS.md': { hash: 'ref-hash' },
        'agent:claude:ddd-developer': { hash: 'claude-hash' },
        'agent:gemini:ddd-developer': { hash: 'gemini-hash' },
        'agent:opencode:ddd-developer': { hash: 'opencode-hash' },
        'agent:codex:ddd-developer': { hash: 'codex-hash' },
      },
    }
    writeFile(join(publish_root, '.build-manifest.json'), JSON.stringify(build_manifest))

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    const result = await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    expect(result.has_changes).toBe(false)
    expect(result.diff.some((entry) => entry.unit === 'agent:gemini:ddd-developer')).toBe(false)
    expect(result.diff.some((entry) => entry.unit === 'agent:opencode:ddd-developer')).toBe(false)
    expect(result.diff.some((entry) => entry.unit === 'agent:codex:ddd-developer')).toBe(false)
  })

  it('should not record skill units when skills are skipped', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {
        'skill:ddd.work': { hash: 'skill-hash' },
        'reference:AGENTS.md': { hash: 'ref-hash' },
      },
    }
    writeFile(join(publish_root, '.build-manifest.json'), JSON.stringify(build_manifest))

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    const deploy_manifest = JSON.parse(readFileSync(resolveDeployManifestPath(home_dir), 'utf8'))
    expect(deploy_manifest.units['reference:AGENTS.md']).toBeDefined()
    expect(deploy_manifest.units['skill:ddd.work']).toBeUndefined()
  })

  it('should ignore skill units when detecting second deploy changes with skills skipped', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {
        'skill:ddd.work': { hash: 'skill-hash' },
        'reference:AGENTS.md': { hash: 'ref-hash' },
      },
    }
    writeFile(join(publish_root, '.build-manifest.json'), JSON.stringify(build_manifest))

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    const result = await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    expect(result.has_changes).toBe(false)
    expect(result.diff.some((entry) => entry.unit === 'skill:ddd.work')).toBe(false)
  })

  it('should fail before deploying generated agent targets when dist is missing', async () => {
    rmSync(join(publish_root, 'dist', 'opencode'), { recursive: true, force: true })

    expect(() => planDeploy({
      publish_root,
      home_dir,
      include_skills: false,
      targets: ['opencode'],
    })).toThrow(/npm run agents:build/)
  })

  it('should make the public deploy bin fail when generated dist is missing', () => {
    rmSync(join(publish_root, 'dist', 'opencode'), { recursive: true, force: true })

    const result = spawnSync('node', [
      join(process.cwd(), 'src', 'tooling', 'bin', 'deploy-agents.js'),
      'opencode',
      '--dry-run',
    ], {
      cwd: publish_root,
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('npm run agents:build')
  })

  it('should not overwrite conflicting Claude statusLine from public deploy bin in non-TTY mode', () => {
    const settings_path = join(home_dir, '.claude', 'settings.json')
    const existing_settings = {
      statusLine: { type: 'command', command: 'custom-statusline' },
      theme: 'dark',
    }
    writeFile(settings_path, JSON.stringify(existing_settings, null, 2))

    const result = spawnSync('node', [
      join(process.cwd(), 'src', 'tooling', 'bin', 'deploy-agents.js'),
      'claude',
    ], {
      cwd: publish_root,
      env: { ...process.env, HOME: home_dir },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(readJson(settings_path)).toEqual(existing_settings)
  })

  it('should skip deploy when second run finds no changes', async () => {
    const { computeSourceTreeHash } = await import('../manifest/build-manifest.js')
    const source_hash = await computeSourceTreeHash(source_root)

    const build_manifest = {
      version: 1,
      sourceTreeHash: source_hash,
      buildTime: '2025-01-01T00:00:00.000Z',
      units: {
        'reference:AGENTS.md': { hash: 'ref-hash' },
      },
    }
    writeFile(
      join(publish_root, '.build-manifest.json'),
      JSON.stringify(build_manifest),
    )

    // First deploy
    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log() {} },
    })

    // Second deploy — should detect no changes
    const log_messages = []
    const result = await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: { log: (msg) => log_messages.push(msg) },
    })

    expect(result.has_changes).toBe(false)
    expect(log_messages.some((msg) => msg.includes('skip'))).toBe(true)
  })
})

describe('manifest-aware deploy full lifecycle', () => {
  let tmp_dir
  let publish_root
  let home_dir
  let source_root
  const silent_logger = { log() {} }
  let original_path

  function writeSourceFixture(root) {
    writeFile(join(root, 'skills', 'ddd.test', 'SKILL.md'), '---\nname: ddd.test\n---\n# Test Skill\n')
    writeFile(join(root, 'agents', 'ddd-test.md'), '# Test Agent\n')
    writeFile(join(root, 'config', 'xreview.json'), '{"reviewers":[]}\n')
    writeFile(join(root, 'references', 'AGENTS.md'), '# Shared Instructions\n')
  }

  function writeMatchingPublishFixture(root) {
    writeFile(join(root, 'agents', 'ddd-test.md'), '# Test Agent\n')
    mkdirSync(join(root, 'dist', 'gemini', 'agents'), { recursive: true })
    mkdirSync(join(root, 'dist', 'codex', 'agents'), { recursive: true })
    mkdirSync(join(root, 'dist', 'opencode', 'agents'), { recursive: true })
    writeFile(join(root, 'config', 'xreview.json'), '{"reviewers":[]}\n')
    writeFile(join(root, 'references', 'AGENTS.md'), '# Shared Instructions\n')
    writeFile(join(root, 'scripts', 'claude', 'statusline.sh'), '#!/bin/sh\n')
    writeFile(join(root, 'scripts', 'shared', 'session-trigger.mjs'), 'console.log("tick")\n')
  }

  async function buildAndWriteManifest() {
    const manifest = await generateBuildManifest({ source_root, publish_root })
    writeFile(
      join(publish_root, '.build-manifest.json'),
      JSON.stringify(manifest, null, 2),
    )
    return manifest
  }

  beforeEach(() => {
    tmp_dir = mkdtempLike(join(tmpdir(), 'lifecycle-deploy-'))
    publish_root = join(tmp_dir, 'publish')
    home_dir = join(tmp_dir, 'home')
    source_root = join(tmp_dir, 'source')

    writeSourceFixture(source_root)
    writeMatchingPublishFixture(publish_root)
    const { bin_dir } = installFakeCrontab(tmp_dir)
    original_path = process.env.PATH
    process.env.PATH = `${bin_dir}:${original_path}`
  })

  afterEach(() => {
    process.env.PATH = original_path
    rmSync(tmp_dir, { recursive: true, force: true })
  })

  it('scenario 1: first deploy installs all units and writes deploy manifest', async () => {
    await buildAndWriteManifest()

    const result = await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: silent_logger,
    })

    // has_changes should be true on first deploy
    expect(result.has_changes).toBe(true)

    // deploy manifest should exist
    const deploy_manifest_path = resolveDeployManifestPath(home_dir)
    expect(existsSync(deploy_manifest_path)).toBe(true)

    // deploy manifest should contain the installed unit keys
    const deploy_manifest = JSON.parse(readFileSync(deploy_manifest_path, 'utf8'))
    const deployed_unit_keys = Object.keys(deploy_manifest.units)
    expect(deployed_unit_keys).toContain('agent:claude:ddd-test')
    expect(deployed_unit_keys).toContain('reference:AGENTS.md')
    expect(deployed_unit_keys).toContain('config:xreview')

    // all diff entries should be install (new unit) on first deploy
    for (const entry of result.diff) {
      expect(entry.action).toBe('install')
      expect(entry.reason).toBe('new unit')
    }

    // target files should have been copied to home_dir
    expect(readFileSync(join(home_dir, '.claude', 'CLAUDE.md'), 'utf8')).toBe('# Shared Instructions\n')
    expect(readFileSync(join(home_dir, '.claude', 'agents', 'ddd-test.md'), 'utf8')).toBe('# Test Agent\n')
  })

  it('scenario 2: second deploy with no changes reports has_changes false', async () => {
    await buildAndWriteManifest()

    // First deploy
    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: silent_logger,
    })

    const deploy_manifest_path = resolveDeployManifestPath(home_dir)
    const manifest_before = readFileSync(deploy_manifest_path, 'utf8')

    // Second deploy with identical state
    const result = await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: silent_logger,
    })

    expect(result.has_changes).toBe(false)

    // deploy manifest content should not have changed
    const manifest_after = readFileSync(deploy_manifest_path, 'utf8')
    expect(JSON.parse(manifest_after).units).toEqual(JSON.parse(manifest_before).units)

    // all diff entries should be skip
    for (const entry of result.diff) {
      expect(entry.action).toBe('skip')
    }
  })

  it('scenario 3: modifying source and rebuilding deploys only changed unit', async () => {
    await buildAndWriteManifest()

    // First deploy to establish baseline
    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: silent_logger,
    })

    // Modify one source file and the corresponding publish file
    writeFileSync(join(source_root, 'agents', 'ddd-test.md'), '# Test Agent v2\n')
    writeFileSync(join(publish_root, 'agents', 'ddd-test.md'), '# Test Agent v2\n')
    writeFileSync(join(home_dir, '.claude', 'CLAUDE.md'), 'user-managed sentinel\n')

    // Rebuild manifest to pick up the change
    await buildAndWriteManifest()

    // Deploy again
    const result = await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: silent_logger,
    })

    expect(result.has_changes).toBe(true)

    // Only the changed unit should be install; others should be skip
    const install_entries = result.diff.filter((e) => e.action === 'install')
    const skip_entries = result.diff.filter((e) => e.action === 'skip')

    expect(install_entries.length).toBeGreaterThanOrEqual(1)
    expect(install_entries.some((e) => e.unit === 'agent:claude:ddd-test')).toBe(true)
    expect(skip_entries.length).toBeGreaterThanOrEqual(1)

    // The target file should be updated
    expect(readFileSync(join(home_dir, '.claude', 'agents', 'ddd-test.md'), 'utf8')).toBe('# Test Agent v2\n')
    expect(readFileSync(join(home_dir, '.claude', 'CLAUDE.md'), 'utf8')).toBe('user-managed sentinel\n')
  })

  it('should remove orphaned managed file targets and clean deploy manifest entries', async () => {
    await buildAndWriteManifest()

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: silent_logger,
    })

    const agent_target = join(home_dir, '.claude', 'agents', 'ddd-test.md')
    expect(existsSync(agent_target)).toBe(true)

    rmSync(join(source_root, 'agents', 'ddd-test.md'), { force: true })
    rmSync(join(publish_root, 'agents', 'ddd-test.md'), { force: true })
    await buildAndWriteManifest()

    const result = await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude'],
      dry_run: false,
      logger: silent_logger,
    })

    expect(result.diff).toContainEqual({
      unit: 'agent:claude:ddd-test',
      action: 'remove',
      reason: 'orphaned',
    })
    expect(existsSync(agent_target)).toBe(false)

    const deploy_manifest = JSON.parse(readFileSync(resolveDeployManifestPath(home_dir), 'utf8'))
    expect(deploy_manifest.units['agent:claude:ddd-test']).toBeUndefined()
  })

  it('should record and remove all managed targets for multi-platform reference units', async () => {
    await buildAndWriteManifest()

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude', 'gemini', 'codex'],
      dry_run: false,
      logger: silent_logger,
    })

    const reference_targets = [
      join(home_dir, '.claude', 'CLAUDE.md'),
      join(home_dir, '.gemini', 'GEMINI.md'),
      join(home_dir, '.codex', 'AGENTS.md'),
    ]
    for (const target of reference_targets) {
      expect(existsSync(target)).toBe(true)
    }

    const manifest_after_install = JSON.parse(readFileSync(resolveDeployManifestPath(home_dir), 'utf8'))
    expect(manifest_after_install.units['reference:AGENTS.md'].target).toBe(reference_targets[0])
    expect(manifest_after_install.units['reference:AGENTS.md'].targets).toEqual(reference_targets)

    rmSync(join(source_root, 'references', 'AGENTS.md'), { force: true })
    rmSync(join(publish_root, 'references', 'AGENTS.md'), { force: true })
    await buildAndWriteManifest()

    await runManifestAwareDeploy({
      publish_root,
      home_dir,
      source_root,
      include_skills: false,
      targets: ['claude', 'gemini', 'codex'],
      dry_run: false,
      logger: silent_logger,
    })

    for (const target of reference_targets) {
      expect(existsSync(target)).toBe(false)
    }

    const manifest_after_remove = JSON.parse(readFileSync(resolveDeployManifestPath(home_dir), 'utf8'))
    expect(manifest_after_remove.units['reference:AGENTS.md']).toBeUndefined()
  })

  it('scenario 4: stale build throws error mentioning pnpm run build', async () => {
    await buildAndWriteManifest()

    // Modify source without rebuilding manifest
    writeFileSync(join(source_root, 'agents', 'ddd-test.md'), '# Modified after build\n')

    await expect(
      runManifestAwareDeploy({
        publish_root,
        home_dir,
        source_root,
        include_skills: false,
        targets: ['claude'],
        dry_run: false,
        logger: silent_logger,
      })
    ).rejects.toThrow(/pnpm run build/)
  })
})
