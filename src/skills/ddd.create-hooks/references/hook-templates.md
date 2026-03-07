# Hook 推薦清單與範本

## 安全防護（PreToolUse）

### 擋敏感檔案讀取

- **matcher**: `Read`
- **用途**: 阻擋讀取 `.env`、`.env.*`、`*secret*`、`*credential*` 等檔案
- **handler type**: `command`

```json
{
  "matcher": "Read",
  "hooks": [{
    "type": "command",
    "command": "bash .claude/hooks/block-sensitive-read.sh"
  }]
}
```

**Script 範例 (`block-sensitive-read.sh`)**:
```bash
#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" =~ \.(env|env\..*)$ ]] || \
   [[ "$FILE_PATH" =~ secret|credential ]]; then
  echo "阻擋讀取敏感檔案: $FILE_PATH" >&2
  exit 2
fi
exit 0
```

### 擋危險指令

- **matcher**: `Bash`
- **用途**: 阻擋含有 `rm -rf`、`DROP TABLE`、`--force`、`--no-verify` 的指令；偵測到 `rm` 時提示改用 `trash-put`
- **handler type**: `command`

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "bash .claude/hooks/block-dangerous-commands.sh"
  }]
}
```

**Script 範例 (`block-dangerous-commands.sh`)**:
```bash
#!/bin/bash
set -euo pipefail
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# 阻擋高風險指令
if echo "$CMD" | grep -qE 'rm\s+-rf|DROP\s+TABLE|--force|--no-verify'; then
  echo "阻擋危險指令: $CMD" >&2
  echo "建議：使用 trash-put 取代 rm" >&2
  exit 2
fi

# 偵測 rm，提示替代方案
if echo "$CMD" | grep -qE '^\s*rm\s'; then
  echo "偵測到 rm 指令，建議改用 trash-put（trash-cli）" >&2
  exit 2
fi

exit 0
```

## 程式碼品質（PostToolUse）

### 自動 Lint/Format

- **matcher**: `Write|Edit|MultiEdit`
- **用途**: 對被修改的檔案執行專案的 lint/format 工具
- **handler type**: `command`

```json
{
  "matcher": "Write|Edit|MultiEdit",
  "hooks": [{
    "type": "command",
    "command": "bash .claude/hooks/auto-format.sh"
  }]
}
```

**Script 範例 (`auto-format.sh`)**:
```bash
#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]] || [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

# 根據副檔名決定 formatter
case "$FILE_PATH" in
  *.js|*.jsx|*.ts|*.tsx|*.css|*.json|*.md)
    npx prettier --write "$FILE_PATH" 2>/dev/null || true
    ;;
  *.py)
    ruff format "$FILE_PATH" 2>/dev/null || true
    ;;
esac

exit 0
```

## Cross Review（PreToolUse）

### Commit 前 Code Review

- **matcher**: `Bash`
- **用途**: 偵測指令包含 `git commit`，啟動 review
- **handler type**: `prompt`
- **說明**: 用低成本 model（如 haiku）審查 `git diff --staged`

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "prompt",
    "prompt": "The user is about to run a git commit. Review the staged changes (git diff --staged) for obvious issues: security vulnerabilities, leftover debug code, missing error handling. If everything looks good, approve. If there are concerns, explain them briefly."
  }]
}
```

**注意**: prompt type 的 hook 會消耗額外 token，但能在 commit 前提供一層額外的 code review 防線。
