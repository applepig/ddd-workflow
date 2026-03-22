import { unlinkSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import * as path from 'node:path'

const SERVICE_NAME = 'claude-r.service'

export async function uninstall(_args: string[]): Promise<void> {
  const home = homedir()
  const service_path = path.join(home, '.config/systemd/user', SERVICE_NAME)

  try {
    execSync('systemctl --user disable --now claude-r.service')
  } catch {
    // Silently ignore — service may never have been installed
  }

  if (existsSync(service_path)) {
    unlinkSync(service_path)
  }

  execSync('systemctl --user daemon-reload')

  console.log('claude-r.service disabled and removed successfully.')
}
