---
name: DDD.Spec
description: >
  撰寫正式規格書 spec.md——包含 User Story、驗收條件、API 契約、ADR。
  Use when the user says "write a spec", "define requirements", "draft acceptance
  criteria", "document a feature", "let's define what we're building",
  or invokes "/DDD.spec". Use whenever a feature needs formal specification
  before implementation.
---

# DDD:spec — 規格制定

規格制定階段。根據需求（或 plan/research 的成果）撰寫正式的規格書。

## 嚴格禁令 (Never Do)

- **嚴禁在 Spec 確認前寫 Code**：規格是使用者與開發者之間的契約——未經確認就動手實作，等於在沒有共識的基礎上蓋房子，改動的代價會隨時間急遽上升。
- **嚴禁省略邊界案例**：邊界案例往往是 bug 的溫床。Spec 階段花 5 分鐘思考「如果輸入為空會怎樣？」，遠比上線後花 5 小時除錯划算。每份 Spec 至少列出一種 Edge Case。
- **嚴禁使用未經確認的技術**：引入新技術會增加維護成本和學習曲線。如果 Spec 牽涉到 `docs/TECHSTACK.md` 以外的技術，必須在 ADR 區塊標註並說明選用原因。

## 執行步驟

1. **準備工作**
   - 建立並切換至 feature branch：使用 `git checkout -b feat/<編號>-<名稱>`（若已有分支則切換過去）
   - 確認或建立 `docs/<編號>-<名稱>/` 資料夾
   - 讀取現有的 plan.md、research.md（如果有的話）
   - 讀取 `docs/PRD.md`、`docs/TECHSTACK.md` 了解專案脈絡

2. **需求分析**
   - 釐清使用者故事與驗收條件
   - 識別需要修改的現有檔案
   - 評估技術可行性與邊界案例

3. **撰寫 spec.md**
   ```markdown
   # <功能名稱>

   ## 目標
   簡述這個功能要達成什麼。

   ## 非目標
   明確列出不在範圍內的事項。

   ## User Story
   作為 <角色>，我想要 <功能>，以便 <價值>。

   ### 驗收條件
   - [ ] 條件 1
   - [ ] 條件 2
   - [ ] 條件 3

   ## 相關檔案
   - `src/path/to/file.js` — 說明

   ## 介面/資料結構 (API / Data Structure)
   （必須明確標示通訊協定：REST / SSE / WebSocket，並提供 Request / Response 的 JSON 範例）

   ## 邊界案例
   - Case 1：描述與處理方式

   ## ADR（Architecture Decision Record）
   - 決策：選用 X 方案
   - 原因：...
   - 替代方案：Y（為何不選）
   ```

   > **ADR 寫作要點**：重點是記錄「為什麼選 A 而不選 B」——未來的維護者需要的是決策脈絡，而非單純的結論。替代方案不需要長篇大論，一兩句說明被排除的理由即可。

4. **規格審查**
   - 將 spec.md 呈現給使用者
   - 根據回饋反覆修改，直到使用者明確同意

## 產出

- `docs/<編號>-<名稱>/spec.md`
- Feature branch: `feat/<編號>-<名稱>`

## 結束條件

使用者確認規格後，引導使用者執行 `/DDD.tasks`。
