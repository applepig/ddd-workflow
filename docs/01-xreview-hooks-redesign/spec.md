# Skill 改版：xreview 動態分發 + create-hooks 探索式建議器

## 目標

改版 ddd-workflow plugin 的兩個 skill 和一個 agent，從「固定流程」演進為「動態、智慧判斷」：

1. **ddd.xreview** — 從固定 2 組 reviewer 改為 2～6 組動態分發，支援多 POV × 多引擎
2. **ddd.create-hooks** — 從固定模板比對改為探索式建議器，依賴 agent 智慧判斷專案需要什麼 hooks
3. **ddd-reviewer agent** — 配合 xreview 改版，支援接收 POV 參數調整審查重點

## 非目標

- 不改動其他 skill（ddd.plan、ddd.spec、ddd.tasks、ddd.work 等）
- 不建立新的 CLI 工具或 MCP server
- 不處理 Gemini / Codex CLI 的安裝或設定（假設使用者環境已安裝）

---

## Feature A：ddd.xreview v2 — 動態分發

### User Story

作為使用 DDD 工作流的開發者，我想要在 code review 時自動獲得多元觀點的審查，以便在不同面向（PM、Tech Lead、Security 等）都能發現潛在問題。

### 驗收條件

- [ ] Agent 能根據變更複雜度自動決定派出 2～6 組 reviewer
- [ ] 支援多種 POV（萬能 reviewer、PM、Tech Lead、Security、DX、Performance）
- [ ] 支援多種引擎（Claude subagent、Gemini CLI、Codex CLI）
- [ ] 分配方式不固定——不一定是 POV × 模型矩陣，可以是任意組合
- [ ] 使用者可透過參數覆寫 POV 和引擎選擇
- [ ] 未指定時，預設為萬能 reviewer 視角
- [ ] Agent 先偵測環境中可用的引擎（`which gemini`、`which codex`），僅使用實際可用的
- [ ] 所有 reviewer 平行執行（`run_in_background`）
- [ ] 外部 CLI 一律用 stdin pipe 傳 prompt，嚴禁 `-p` 參數
- [ ] 最終產出交叉比對報告，標示共識與分歧
- [ ] 嚴禁自動修改程式碼，嚴禁省略任一 reviewer 的意見

### 設計細節

#### POV 定義

| POV | 審查重點 | 適用場景 |
|-----|---------|---------|
| **萬能 reviewer**（預設） | 全維度均衡審查 | 所有變更 |
| **PM** | 是否符合 spec 驗收條件？使用者體驗？ | 涉及 UI/UX、流程變更 |
| **Tech Lead** | 架構合理性？可維護性？技術債？ | 架構變更、新模組 |
| **Security** | 注入、XSS、機密洩漏、認證/授權？ | 涉及 auth、API、外部輸入 |
| **DX** | API 設計？文件完整？開發者上手難度？ | 共用模組、SDK、plugin |
| **Performance** | 效能瓶頸？記憶體洩漏？N+1 query？ | 資料密集、高併發路徑 |

#### 動態分配邏輯

Agent 根據以下因素判斷：

1. **變更規模**：diff 行數、檔案數
2. **變更類型**：新功能 / bug fix / 重構 / 安全修正
3. **涉及領域**：前端 / 後端 / infra / 共用模組
4. **可用引擎**：環境中實際安裝的 CLI 工具

分配範例（僅供參考，agent 有完全的調度自由）：

| 場景 | 可能的分配 |
|------|-----------|
| 小幅 bug fix | 2 組：萬能 × [Claude, Gemini] |
| 新功能（中等） | 3 組：PM × Gemini, Tech Lead × Claude, 萬能 × Codex |
| 安全相關變更 | 4 組：Security × [Claude, Gemini], Tech Lead × Codex, 萬能 × Claude |
| 大型架構重構 | 6 組：3 POV × 2 引擎 |

#### 引擎呼叫方式

| 引擎 | 呼叫方式 | 備註 |
|------|---------|------|
| Claude subagent | `Agent` tool，`subagent_type: "ddd-reviewer"` | 不能用 `claude -p`（巢狀禁止） |
| Gemini CLI | `echo "$prompt" \| gemini -y --output-format text` | stdin pipe，不用 `-p` |
| Codex CLI | `echo "$prompt" \| codex exec -` | stdin 模式 |

#### Review Prompt 模板

沿用現有的 review prompt 模板結構，但在開頭加入 POV 指示：

```
你是一位資深的 code reviewer，從【{POV}】的視角審查程式碼。

{POV 專屬指引——由 agent 根據 POV 定義動態生成}

## Review 範圍
...（與現有模板相同）
```

---

## Feature B：ddd.create-hooks v2 — 探索式建議器

### User Story

作為使用 Claude Code 的開發者，我想要讓 agent 探索我的專案後，主動建議適合的 hooks，以便我能快速建立符合專案需求的自動化防護與品質控制。

### 驗收條件

- [ ] Agent 能自主探索專案結構、技術棧、開發慣例
- [ ] 根據探索結果產出客製化的 hook 建議，而非套用固定模板
- [ ] 建議涵蓋以下分類（視專案需求，不必全部）：
  - Code Quality：自動 lint/format
  - Safety Guards：阻擋危險操作、保護敏感檔案
  - Testing：完成前自動跑測試
  - Git Workflow：commit 前檢查、branch 保護
  - Notifications：桌面通知、等待輸入提醒
  - Context Management：session start / compaction 後重注入上下文
- [ ] 建議需考慮四種 hook handler type（command、http、prompt、agent），根據場景選用最適合的
- [ ] 現有 `references/hook-templates.md` 的內容降級為範例參考，不再作為推薦清單的來源
- [ ] 合併至現有 `.claude/settings.json`，不覆蓋使用者已有的設定
- [ ] 需重啟 session 生效的提醒保留

### 設計細節

#### 探索策略

Agent 應自主執行以下探索（不限於此）：

1. **技術棧偵測**
   - `package.json`、`pyproject.toml`、`Cargo.toml`、`go.mod` 等
   - 已安裝的 lint/format 工具（prettier、eslint、biome、ruff、gofmt 等）
   - 測試框架（vitest、jest、pytest、go test 等）

2. **專案慣例偵測**
   - 是否有 `.env` 或 secrets 相關檔案
   - 是否有 CI/CD 設定（`.github/workflows/`、`.gitlab-ci.yml`）
   - 是否有 Docker 相關檔案
   - 現有 `.claude/settings.json` 中已設定的 hooks

3. **風險評估**
   - 專案是否處理敏感資料（auth、payment 等）
   - 是否有需要保護的設定檔

#### Hook Handler 選用指引

| 場景 | 推薦 Handler | 原因 |
|------|-------------|------|
| 快速確定性檢查（regex match） | `command` | 零 LLM overhead，毫秒級 |
| 需要理解語意的判斷 | `prompt` | 單輪 LLM，低成本 |
| 需要讀多個檔案做判斷 | `agent` | 可使用 Read/Grep 工具 |
| 需要通知外部系統 | `http` | 直接 POST |

#### 與現有版本的差異

| 面向 | v1（目前） | v2（改版） |
|------|-----------|-----------|
| 建議來源 | 固定模板清單（hook-templates.md） | Agent 探索專案後動態生成 |
| 比對方式 | 技術棧 → 模板篩選 | Agent 綜合判斷專案需求 |
| Handler 類型 | 僅 command | command / prompt / agent / http 四種 |
| 範本角色 | 推薦清單的唯一來源 | 降級為參考範例 |

---

## Feature C：ddd-reviewer agent v2 — POV 支援

### User Story

作為 xreview 的調度者（main agent），我想要讓 ddd-reviewer 根據指定的 POV 調整審查重點，以便同一個 agent 定義能產出不同視角的 review。

### 驗收條件

- [ ] Reviewer 的 system prompt 支援 POV 參數（透過 review prompt 開頭的 POV 指引傳入）
- [ ] 未指定 POV 時，退回到現有的萬能 reviewer 行為
- [ ] 各 POV 的審查重點映射清楚（見 Feature A 的 POV 定義表）
- [ ] 維持「只讀不改」的核心限制
- [ ] 維持現有的報告輸出格式

### 設計細節

Reviewer agent 本身的 system prompt 不需要大幅修改——POV 的差異由 xreview 在組裝 review prompt 時注入。Reviewer agent 只需要：

1. 理解 POV 指引是 review prompt 的一部分
2. 在產出報告時標示自己的 POV
3. 將審查精力集中在 POV 對應的維度

---

## 相關檔案

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| `skills/ddd.xreview/SKILL.md` | 改寫 | 動態分發邏輯、多 POV、多引擎 |
| `skills/ddd.xreview/references/review-prompt.md` | 改寫 | 加入 POV 指引區塊 |
| `skills/ddd.create-hooks/SKILL.md` | 改寫 | 探索式流程取代固定模板比對 |
| `skills/ddd.create-hooks/references/hook-templates.md` | 改寫 | 降級為範例參考，更新內容含四種 handler type |
| `agents/ddd-reviewer.md` | 小幅修改 | 在 system prompt 中加入 POV 識別 |

## 邊界案例

1. **環境中無任何外部 CLI**：僅用 Claude subagent，至少派 2 組（不同 POV）
2. **變更範圍為零**（clean working tree）：提示使用者無變更可 review
3. **某個引擎超時或失敗**：先呈現已取得的結果，提示使用者是否重試
4. **使用者指定的 POV 或引擎數量超過 6**：提醒上限為 6，建議拆分 review
5. **hook-templates.md 的範例過時**：因為已降級為參考，不影響功能——agent 以探索結果為主

## ADR

### ADR-1：xreview 採用動態分配而非固定矩陣

- **決策**：reviewer 數量和 POV × 引擎的分配由 agent 動態決定
- **原因**：固定矩陣（如 2 POV × 3 引擎 = 6 組）在簡單變更時浪費資源，在複雜變更時可能 POV 不足。動態分配讓 agent 根據實際情況做最佳判斷。
- **替代方案**：固定 POV × 引擎矩陣（過於僵化）、使用者每次手動指定（過於繁瑣）

### ADR-2：create-hooks 從模板驅動改為探索驅動

- **決策**：agent 先探索專案，再產出客製化建議，模板降為參考範例
- **原因**：固定模板無法涵蓋所有專案類型和開發慣例。agent 的判斷力比 regex 比對更能理解專案的真正需求。四種 hook handler type（尤其 prompt 和 agent）需要語意理解才能正確推薦。
- **替代方案**：擴充模板清單（維護成本高、永遠不夠全）、讓使用者自己查文件手動設定（門檻高）

### ADR-3：POV 透過 prompt 注入而非 agent 定義拆分

- **決策**：不為每個 POV 建立獨立的 agent 定義，而是在 review prompt 中注入 POV 指引
- **原因**：POV 的數量和定義可能持續演進，透過 prompt 注入比維護多個 agent 定義更靈活。reviewer 的核心行為（讀 spec、看 diff、產出報告）不因 POV 而異。
- **替代方案**：每個 POV 一個 agent 定義（如 `ddd-reviewer-pm.md`、`ddd-reviewer-security.md`）——維護成本高，且核心邏輯大量重複
