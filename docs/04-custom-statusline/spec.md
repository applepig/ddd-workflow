# Spec: Custom Status Line — Phase 2（OAuth Usage API）

## 背景

Phase 1 已完成：基於 StatusJSON 的三行 statusline（Model、Context bar、Reset timer、Session bar、Git info）。

但 StatusJSON 的 `rate_limits` 欄位資料有限——只有 `five_hour` 的 `used_percentage` 和 `resets_at`。
參考 `ccstatusline` 社群的做法（`~/.claude/statusline.sh`），可以直接打 Anthropic OAuth Usage API 取得更完整的用量資訊。

## 目標

- 整合 OAuth Usage API，取得 5-hour / 7-day / extra usage 三組 rate limit 數據
- 實作 API response 快取機制，避免每次 statusline 刷新都打 API
- 將 API 數據融入現有三行布局，替換 StatusJSON 的 `rate_limits` 資料

## 非目標

- 不改動現有布局結構（維持三行）
- 不處理 OAuth token 的申請或刷新流程（只讀取既有 token）

## 技術調研：OAuth Usage API

### API Endpoint

```
GET https://api.anthropic.com/api/oauth/usage
```

### 必要 Headers

```
Authorization: Bearer <oauth_token>
anthropic-beta: oauth-2025-04-20
```

### Response 結構

```json
{
  "five_hour": {
    "utilization": 42,
    "resets_at": "2026-04-02T15:30:00Z"
  },
  "seven_day": {
    "utilization": 18,
    "resets_at": "2026-04-05T00:00:00Z"
  },
  "extra_usage": {
    "is_enabled": true,
    "utilization": 25,
    "used_credits": 1250,
    "monthly_limit": 5000
  }
}
```

- `utilization`：百分比（0–100），可直接用於 progress bar
- `resets_at`：ISO 8601 時間，用於倒數計時
- `used_credits` / `monthly_limit`：單位為 cents（除以 100 得美元）

### OAuth Token 取得位置（依優先序）

1. 環境變數 `$CLAUDE_CODE_OAUTH_TOKEN`
2. `~/.claude/.credentials.json` → `.claudeAiOauth.accessToken`
3. Linux keyring（`secret-tool lookup service "Claude Code-credentials"`）

## 快取機制

| 項目 | 設計 |
|------|------|
| 快取路徑 | `/tmp/claude/statusline-usage-cache.json` |
| 有效時間 | 60 秒（`cache_max_age=60`） |
| 判斷方式 | 比對檔案 mtime 與當前時間 |
| 快取命中 | 直接讀取檔案，不打 API |
| 快取過期 | 打 API → 成功則寫入新快取；失敗則用舊快取 fallback |
| API 逾時 | `curl --max-time 5`，5 秒無回應視為失敗 |

## 布局

### 模式切換

透過 `tput cols` 偵測 terminal 寬度，≥60 columns 用完整版，<60 用 compact 版。

### 完整版（≥60 cols）

維持三行，Line 2 改用 API 數據：

```
 Opus 4.6    ████████████████░░░░░░░░░  160k
 ⟳ 4h30m     ●●●●●○○○○○ 42%  ●●○○○○○○○○ 18%
 AGENTS      master  +12 -5
```

#### Line 2 變更

| 現行 | 改為 |
|------|------|
| Reset timer（從 StatusJSON） | Reset timer（從 API `five_hour.resets_at`） |
| Session bar（從 StatusJSON `used_percentage`） | 5-hour bar + 7-day bar（從 API `utilization`） |

#### Extra Usage（條件顯示）

當 `extra_usage.is_enabled === true` 時，在 Line 2 尾端附加花費資訊：

```
 ⟳ 4h30m     ●●●●●○○○○○ 42%  ●●○○○○○○○○ 18%  $12.50/$50.00
```

### Compact 版（<60 cols）

單行，純文字 + 上色數字，適用於 iPad Termius 直放等窄 terminal：

```
Opus 4.6 | CTX 22% | USG 84% | RES 10m
```

| 欄位 | 來源 | 上色規則 |
|------|------|----------|
| Model | `model.id` 格式化 | 無（原色） |
| CTX | context window 使用百分比 | 0–60% 綠、60–80% 橘、80%+ 紅 |
| USG | `five_hour.utilization`（API 或 StatusJSON） | 0–60% 綠、60–80% 橘、80%+ 紅 |
| RES | `five_hour.resets_at` 倒數計時 | 無（原色） |

分隔符號用 ` | `（含空格），不上色。

## 驗收條件

- [ ] 能從 credentials 檔案讀取 OAuth token
- [ ] 成功呼叫 Usage API 並解析 response
- [ ] 快取機制運作：60 秒內不重複呼叫 API
- [ ] API 失敗時 fallback 到舊快取或 StatusJSON 資料
- [ ] 完整版 Line 2 正確顯示 5-hour / 7-day utilization
- [ ] Extra usage 條件顯示（enabled 時才出現）
- [ ] API 逾時不阻塞 statusline 輸出（5 秒上限）
- [ ] Terminal 寬度 ≥60 顯示完整版三行布局
- [ ] Terminal 寬度 <60 顯示 compact 版單行布局
- [ ] Compact 版 CTX / USG 數字套用色彩規則，RES 不套用

## ADR

### ADR-1：快取存放位置

**決策**：使用 `/tmp/claude/` 而非 `~/.claude/cache/`。

**原因**：statusline 每秒可能刷新多次，快取檔是高頻寫入的暫存資料。`/tmp` 在多數 Linux 發行版是 tmpfs（記憶體），寫入不落磁碟。放在 `~/.claude/` 會產生不必要的磁碟 I/O，且 Dropbox 等同步工具會不斷同步這種暫存檔。

### ADR-2：Token 解析只讀取，不刷新

**決策**：只從既有位置讀取 token，不處理 token 過期或刷新。

**原因**：Token 刷新是 Claude Code 本身的職責。statusline 是唯讀的旁觀者——能讀到就用，讀不到就 fallback。避免引入複雜的 OAuth 流程，也避免 race condition。

### ADR-3：API 失敗不中斷顯示

**決策**：API 呼叫失敗時，依序 fallback：舊快取 → StatusJSON `rate_limits` → 不顯示 rate limit 區塊。

**原因**：statusline 的首要職責是「永遠要有輸出」。API 是錦上添花，不能因為網路問題讓整個 statusline 空白。
