#!/bin/sh
# SessionStart：補上 Claude Code 環境資訊沒有的 hostname 與發行版（只有 kernel 版本）。
os_name=$(. /etc/os-release 2>/dev/null && printf '%s' "$PRETTY_NAME")
echo "Host: $(hostname -s) · OS: ${os_name:-unknown}"
