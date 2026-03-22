import { mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import os from 'node:os'
import * as path from 'node:path'

const SERVICE_NAME = 'claude-r.service'

function generateServiceFile(home: string): string {
  const main_ts_path = path.resolve(import.meta.dirname, '../main.ts')
  const tsx_path = execSync('which tsx', { encoding: 'utf-8' }).trim()

  return `[Unit]
Description=Claude Remote Session Manager

[Service]
Type=simple
ExecStart=${tsx_path} ${main_ts_path} daemon
Restart=always
RestartSec=5
Environment=HOME=${home}

[Install]
WantedBy=default.target
`
}

export async function install(_args: string[]): Promise<void> {
  const home = os.homedir()
  const username = os.userInfo().username
  const service_dir = path.join(home, '.config/systemd/user')
  const service_path = path.join(service_dir, SERVICE_NAME)

  mkdirSync(service_dir, { recursive: true })

  const service_content = generateServiceFile(home)
  writeFileSync(service_path, service_content)

  execSync('systemctl --user daemon-reload')
  execSync('systemctl --user enable --now claude-r.service')

  const linger_status = execSync(
    `loginctl show-user ${username} -p Linger --value`,
    { encoding: 'utf-8' }
  ).trim()

  if (linger_status !== 'yes') {
    console.log(`Linger is not enabled. Run: sudo loginctl enable-linger ${username}`)
  }

  console.log('claude-r.service installed and enabled successfully.')
}
