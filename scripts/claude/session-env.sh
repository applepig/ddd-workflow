#!/bin/sh
# SessionStart：補上 Claude Code 環境資訊沒有的 hostname 與發行版（只有 kernel 版本）。
# spec 49 AC9：沒有 os-release（如 macOS）時改用 sw_vers，再不行用 uname -sr。
# SESSION_ENV_OS_RELEASE 只供測試模擬「沒有 os-release」。
os_release=${SESSION_ENV_OS_RELEASE:-/etc/os-release}
os_name=$(. "$os_release" 2>/dev/null && printf '%s' "$PRETTY_NAME")
if [ -z "$os_name" ]; then
  if command -v sw_vers >/dev/null 2>&1; then
    os_name="$(sw_vers -productName) $(sw_vers -productVersion)"
  else
    os_name=$(uname -sr)
  fi
fi
echo "Host: $(hostname -s) · OS: ${os_name:-unknown}"
