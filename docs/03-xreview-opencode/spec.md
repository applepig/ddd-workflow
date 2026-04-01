# xreview v3：OpenCode 統一外部 Reviewer + 分段約束 Prompt

## 目標

改版 `ddd.xreview` skill，以 OpenCode CLI 統一外部 reviewer 的呼叫方式，並升級 review prompt 引入分段約束（segmented constraints）哲學，提升 finding 品質。

核心改進：
1. **統一工具鏈**：用 OpenCode CLI 同時驅動 GPT-5.4 和 Gemini 3.1 Pro，取代分別呼叫 Codex CLI + Gemini CLI
2. **分段約束 Prompt**：借鑑 Codex adversarial review 的 prompt 設計，用正交的約束段落圍出精確的 reviewer 行為空間
3. **Read-only 強制**：透過 OpenCode 的 permission 系統（`edit: deny`）在技術層面禁止 reviewer 改 code

## 非目標

- 不改動其他 DDD skill（plan、spec、tasks、work 等）
- 不實作 01-spec 中的動態分發 / 多 POV 機制（本次聚焦在工具鏈與 prompt 品質）
- 不建立新的 CLI 工具或 MCP server
- 不處理 OpenCode 的安裝與設定（假設使用者環境已安裝）

## User Story

作為使用 DDD 工作流的開發者，我想要在 cross review 時獲得三個獨立模型（Claude、GPT-5.4、Gemini 3.1 Pro）的高品質審查，每個 finding 都有明確的程式碼定位、嚴重度與信心分數，以便我能快速判斷哪些問題值得修正。

### 驗收條件

- [ ] Skill 定義為 `ddd.xreview-3`，對應 slash command `/DDD.Xreview3`
- [ ] 三個 reviewer 平行執行：Claude subagent + OpenCode(GPT-5.4) + OpenCode(Gemini 3.1 Pro)
- [ ] OpenCode reviewer 使用自訂 agent 定義，permission 設為 `edit: deny`、`bash: deny`（預設）+ git 指令白名單（read-only 保證）
- [ ] Review prompt 包含分段約束結構：operating_stance、attack_surface、finding_bar、calibration_rules、grounding_rules
- [ ] 每個 finding 包含：嚴重度、信心分數（高/中/低）、檔案:行號、問題描述、具體修正建議
- [ ] 模型固定：GPT-5.4（`openai/gpt-5.4`）、Gemini 3.1 Pro Preview（`google/gemini-3.1-pro-preview`，失敗 fallback 至 `google/gemini-2.5-pro`）
- [ ] 外部 CLI 一律用 stdin pipe 傳 prompt，嚴禁在 command line 暴露 prompt 內容
- [ ] 輸出為 markdown（非 JSON），由 Claude Code 整合為交叉比對報告
- [ ] 偵測 OpenCode 可用性（`which opencode`），不可用時僅用 Claude subagent 並明確標示
- [ ] 外部模型失敗時在 OpenCode 內降級模型（GPT-5.4 → gpt-5.2、Gemini 3.1 Pro → 2.5 Pro），不切換工具
- [ ] 嚴禁自動修改程式碼，嚴禁省略任一 reviewer 的意見

## 架構設計

### 三方 Reviewer 配置

| Reviewer | 工具 | 模型 | Read-only 機制 | 費用來源 |
|----------|------|------|---------------|---------|
| Claude | Agent tool（ddd-reviewer subagent） | inherit（Opus/Sonnet） | Agent 只有 Read/Grep/Glob/Bash tools | Claude Code 訂閱 |
| GPT-5.4 | OpenCode CLI | `openai/gpt-5.4` | OpenCode permission: `edit: deny` | Copilot Pro（$10/月，1x multiplier） |
| Gemini 3.1 Pro | OpenCode CLI | `google/gemini-3.1-pro-preview` | OpenCode permission: `edit: deny` | Copilot 或 Google API key |

### OpenCode 呼叫方式

```bash
# GPT-5.4 reviewer
echo "$review_prompt" | opencode run \
  --agent reviewer \
  --model openai/gpt-5.4 \
  2>&1

# Gemini 3.1 Pro reviewer
echo "$review_prompt" | opencode run \
  --agent reviewer \
  --model google/gemini-3.1-pro-preview \
  2>&1
```

### OpenCode Reviewer Agent 定義

在專案的 `.opencode/agent/reviewer.md`（或 OpenCode config）中定義：

```yaml
# ~/.config/opencode/agents/reviewer.md（YAML frontmatter）
---
description: Read-only code reviewer
permission:
  read: allow
  edit: deny
  bash:
    "*": deny
    "git log*": allow
    "git diff*": allow
    "git show*": allow
    "git status*": allow
    "git branch*": allow
    "git --no-pager*": allow
    "git rev-parse*": allow
    "git merge-base*": allow
    "git ls-files*": allow
  glob: allow
  grep: allow
  list: allow
  webfetch: deny
  websearch: deny
  task: deny
  question: deny
---
```

核心約束：`edit: deny` 確保 reviewer 無法修改任何檔案。`bash` 採用白名單機制——預設 deny，僅允許特定的 git 唯讀指令。

### 退化策略（Fallback）

所有退化都在 OpenCode 範圍內，透過降級模型處理，不切換工具：

```
opencode 可用？
├─ 是 → 三方 review（Claude subagent + OpenCode/GPT-5.4 + OpenCode/Gemini-3.1-Pro）
│        │
│        ├─ GPT-5.4 失敗 → 降級至 openai/gpt-5.2
│        ├─ Gemini 3.1 Pro 失敗（429 等）→ 降級至 google/gemini-2.5-pro
│        └─ 兩個外部模型都失敗 → 報告中標示，僅呈現 Claude 結果
│
└─ 否 → 僅 Claude subagent（報告中明確標示「因 OpenCode 未安裝，僅使用單一 reviewer」）
```

退化時 skill 應在報告中明確標示實際使用的 reviewer 組合與退化原因。

## Review Prompt 設計——分段約束

借鑑 Codex adversarial review 的設計，用獨立的約束段落取代「請依維度審查」的單一指令。每個段落控制 reviewer 行為的一個面向，段落之間正交互補。

### Prompt 結構

```markdown
<role>
你是一位獨立的程式碼審查員，從程式碼品質與可靠性的角度審查變更。
你的目標是找出真正重要的問題，而非產出表面的通過/不通過判定。
</role>

<task>
審查以下範圍的程式碼變更。
- Sprint 文件：{{SPEC_PATH}} / {{TASKS_PATH}}
- 變更範圍：請自行執行 `{{GIT_DIFF_CMD}}` 取得變更內容
請先讀取 sprint 文件理解目標與驗收條件，再檢視程式碼變更。
</task>

<operating_stance>
預設保持懷疑。
假設變更可能在細微、高成本、或使用者可見的方式上失敗，直到證據顯示相反。
不因為「意圖良好」或「後續會修」而放過問題。
只在 happy path 上運作的程式碼，視為真實的弱點。
</operating_stance>

<attack_surface>
優先檢查代價高昂、難以偵測的失敗類型：
- 認證、權限、租戶隔離、信任邊界
- 資料遺失、損壞、重複、不可逆的狀態變更
- rollback 安全性、retry、partial failure、冪等性缺失
- race condition、順序假設、stale state、re-entrancy
- 空值、null、timeout、依賴降級行為
- 版本偏移、schema drift、migration 風險、相容性回歸
- 可觀測性缺口（會隱藏故障或拖累恢復的）
</attack_surface>

<review_dimensions>
除了上述攻擊面，也檢查以下維度：
1. 正確性：邏輯是否正確？是否符合 spec 驗收條件？
2. 邊界案例：空值、錯誤輸入、極端情況是否處理？
3. 測試覆蓋：變更的邏輯是否有對應測試？邊界案例是否覆蓋？
4. 可維護性：命名清晰？結構合理？是否符合專案規範？
5. 效能：不必要的迴圈、重複計算、記憶體洩漏？
</review_dimensions>

<finding_bar>
只回報有實質意義的問題。不包含 style 意見、命名偏好、低價值清理、或沒有證據的推測。
每個 finding 必須回答：
1. 什麼會壞？
2. 為什麼這段程式碼脆弱？
3. 可能的影響是什麼？
4. 具體的修正建議是什麼？
</finding_bar>

<calibration_rules>
一個強 finding 勝過數個弱 finding。不要用 filler 稀釋嚴重問題。
如果變更看起來安全，直接說安全，不要硬湊問題。
</calibration_rules>

<grounding_rules>
保持積極但有根據。
每個 finding 必須能從提供的程式碼或工具輸出中找到依據。
不得捏造檔案、行號、程式碼路徑、事件或執行時期行為。
如果結論依賴推論，在 finding 中明確說明，並誠實評估信心程度。
</grounding_rules>

<output_format>
請用以下格式回覆：

### 總評
<一段話總結：ship / 需要修正 / 嚴重問題需阻擋>

### 各維度評估
| 維度 | 判定 | 說明 |
|------|------|------|
| 正確性 | ✅/⚠️/❌ | ... |
| 邊界案例 | ✅/⚠️/❌ | ... |
| 安全性 | ✅/⚠️/❌ | ... |
| 效能 | ✅/⚠️/❌ | ... |
| 可維護性 | ✅/⚠️/❌ | ... |
| 測試覆蓋 | ✅/⚠️/❌ | ... |

### 具體問題
1. **[嚴重度: 高/中/低] [信心: 高/中/低]** `檔案:行號` — 問題描述
   - **為什麼脆弱**：...
   - **影響**：...
   - **建議修正**：...
2. ...

### 優點
- 值得肯定的設計或實作
</output_format>
```

### 與現行 Prompt 的差異

| 面向 | 現行 xreview | xreview v3 |
|------|-------------|------------|
| 立場 | 未明確設定 | `<operating_stance>` 預設懷疑 |
| 攻擊面 | 無 | `<attack_surface>` 列出 7 類高風險區域 |
| Finding 品質 | 「問題描述與建議修正」 | `<finding_bar>` 要求回答 4 個問題 |
| 信心校準 | 無 | `<calibration_rules>` 抑制 filler |
| 幻覺防護 | 無 | `<grounding_rules>` 要求證據 |
| 信心分數 | 無 | 每個 finding 標註 高/中/低 |

## 相關檔案

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| `ddd-workflow/skills/ddd.xreview-3/SKILL.md` | **新增** | 新 skill 定義 |
| `ddd-workflow/skills/ddd.xreview-3/references/review-prompt.md` | **新增** | 分段約束 prompt 模板 |
| `ddd-workflow/skills/ddd.xreview-3/references/opencode-reviewer.md` | **新增** | OpenCode reviewer agent 設定範例 |

> 不修改現有 `ddd.xreview/` 和 `ddd-reviewer.md`——新舊 skill 並存，待驗證穩定後再決定是否取代。

## 邊界案例

1. **OpenCode 未安裝**：僅用 Claude subagent，報告中明確標示
2. **Copilot 未登入 / API key 未設定**：OpenCode 無法認證 → 僅用 Claude subagent，提示使用者設定認證
3. **Gemini 3.1 Pro 容量不足（429）**：OpenCode 內自動 fallback 至 `google/gemini-2.5-pro`
4. **GPT-5.4 失敗**：OpenCode 內自動 fallback 至 `openai/gpt-5.2`
5. **某個 reviewer 超時或失敗**：先呈現已取得的結果，提示使用者是否重試
6. **變更範圍為零**：提示使用者無變更可 review
6. **OpenCode `run` 模式的 bash permission 問題**：若 headless 模式下 `bash` 被 deny 導致無法執行 `git diff`，需在 prompt 中改為指示 reviewer 用 `read` tool 配合 `glob/grep` 替代

## ADR

### ADR-1：選用 OpenCode 統一外部 reviewer，而非分別使用 Codex CLI + Gemini CLI

- **決策**：用 OpenCode 作為統一的外部 reviewer CLI
- **原因**：一個 CLI、一套 permission 設定、一個 agent 定義，切換模型只需改 `--model` flag。免去維護三套不同 CLI 的 read-only 機制（Codex sandbox、Gemini policy engine、各自的 flag 組合）
- **替代方案**：分別呼叫 Codex CLI（`codex exec --sandbox read-only`）和 Gemini CLI（`gemini --policy review-readonly.toml`）——功能上可行，但維護成本高、每套 CLI 的 read-only 機制不同
- **額外好處**：退化策略在同一工具內降級模型（如 GPT-5.4 → gpt-5.2），不需要切換到不同 CLI 及其不同的 flag 組合
- **風險**：OpenCode 的 headless `run` 模式尚未實測 `bash` permission 是否如預期運作。若驗證失敗，需評估替代方案

### ADR-2：Review prompt 採用分段約束結構

- **決策**：用 `<operating_stance>`、`<attack_surface>`、`<finding_bar>`、`<calibration_rules>`、`<grounding_rules>` 等獨立段落組成 review prompt
- **原因**：借鑑 Codex adversarial review 的設計——與其給一個模糊的角色描述，不如用多個正交的約束條件圍出精確的行為空間。每個段落控制 reviewer 的一個行為面向，段落之間互不干擾
- **替代方案**：沿用現行的「角色描述 + 維度列表」單一段落 prompt——簡單但 finding 品質不穩定，reviewer 容易湊數、缺乏證據

### ADR-3：新建 skill 而非修改現有 xreview

- **決策**：建立 `ddd.xreview-3` 作為獨立 skill，不修改 `ddd.xreview`
- **原因**：OpenCode 整合和分段約束 prompt 都是未驗證的實驗性改進。並存讓使用者可以隨時切回穩定版本，避免實驗性改動影響日常工作流
- **替代方案**：直接改寫 `ddd.xreview`——風險是如果新方案有問題，回滾成本高

### ADR-4：使用 Copilot credentials 降低 review 成本

- **決策**：OpenCode 優先使用 GitHub Copilot credentials 存取 GPT-5.4 和 Gemini 3.1 Pro
- **原因**：Copilot Pro $10/月包含 300 premium requests（1x multiplier），相當於 $0.033/次 review，比直接使用 API（GPT-5.4 約 $0.12/次、Gemini 3.1 Pro 約 $0.10/次）便宜三倍以上
- **替代方案**：直接使用各家 API key——費用較高但無 Copilot 依賴
- **注意**：Gemini 3.1 Pro 透過 Copilot 也是 1x multiplier。若三方 review 全走 Copilot，每日 10 次 review = 每月 600 requests，Pro 方案的 300 included 不夠，需 Pro+（$39/月，1500 included）或支付超額費用

## 待驗證事項（Spec 確認後、Tasks 拆解前需先驗證）

1. **OpenCode `run` 模式的 permission 行為**：自訂 agent 的 `bash: deny`（+ git 白名單）+ `edit: deny` 在 headless 模式下是否如預期運作？
2. **OpenCode Copilot 認證**：`opencode run --model openai/gpt-5.4` 能否正確使用 Copilot credentials？
3. **OpenCode stdin pipe**：`echo "$prompt" | opencode run` 是否正確讀取 stdin？
4. **Gemini 3.1 Pro fallback**：OpenCode 是否支援 model fallback 機制，或需要在 skill 層實作 retry？
