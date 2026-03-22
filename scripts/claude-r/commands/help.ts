export function help(): void {
  console.log(`Usage: claude-r <command> [options]

Commands:
  add [--dir PATH] [--name NAME] [--restart POLICY]   Add a managed session
  rm <NAME> [--all] [--force]                          Remove session(s)
  ls [--quiet]                                         List sessions
  restart <NAME>                                       Restart a session
  rename <OLD> <NEW>                                   Rename a session
  resume <NAME>                                        Attach to tmux session
  daemon                                               Run reconciliation loop
  install                                              Install systemd service
  uninstall                                            Remove systemd service
  help                                                 Show this help

Options:
  -h, --help    Show help`)
}
