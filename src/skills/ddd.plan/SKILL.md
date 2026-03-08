---
name: DDD.Plan
description: >
  需求還模糊時的前置規劃——釐清方向、探索可能性、產出 plan.md。
  Use when the user says "plan a feature", "clarify requirements", "figure out
  what to build", "I have an idea", "scope a feature", "what should we build",
  or invokes "/DDD.plan". Even if the user just describes a rough concept,
  this skill helps shape it into actionable direction before writing a spec.
---

# DDD:plan — 前置規劃

前置規劃階段。當需求還不明確、無法直接寫 spec 時，先用這個階段釐清方向。

## 嚴格禁令 (Never Do)

- **嚴禁撰寫程式碼**：過早實作會讓討論從「該做什麼」偏移到「怎麼做」，導致需求被技術限制反向塑形。此階段純粹是需求釐清，不可產出任何實作程式碼、假資料或修改專案設定檔。
- **嚴禁自行腦補需求**：AI 傾向用「合理猜測」填補模糊地帶，但猜錯的假設一旦進入後續文件就很難被發現。需求模糊時必須提問釐清，不可自行假設商業邏輯。

## 執行步驟

1. **閱讀現有文件**
   - 優先查閱 `docs/PRD.md` 或 `docs/README.md` 了解專案大背景（若存在）。
   - 檢查 `docs/` 目錄下是否已有類似或相關的需求文件。

2. **建立文件包 (Optional)**
   - 如果這是一個全新的需求，確認或建立 `docs/<編號>-<名稱>/` 資料夾
   - 建立 `plan.md`

3. **需求釐清**
   - 用 AskUserQuestion 向使用者確認以下問題：
     - 這個功能要解決什麼問題？
     - 預期的使用者是誰？
     - 有沒有已知的限制或偏好？
   - 根據回答整理出初步方向

4. **撰寫 plan.md**（維持以下大綱結構）
   - **背景 (Background)**：為什麼要做這個功能、解決什麼痛點
   - **粗略目標 (High-level Goals)**：條列式描述預期達成的目標
   - **可能的方向 (Potential Directions)**：列出 2~3 個可行方案及其優缺點
   - **待釐清事項 (Open Questions)**：具體且可被後續 research 階段執行的技術/規格問題
   - **下一步建議 (Next Step)**：建議進入 research 還是直接寫 spec

5. **交付**
   - 將 plan.md 內容呈現給使用者確認
   - 根據回饋調整，直到使用者同意方向

## 產出

`docs/<編號>-<名稱>/plan.md`

## 結束條件

使用者確認方向後，建議下一步：
- 需要技術調研 → 引導使用者執行 `/DDD.research`
- 方向已明確 → 引導使用者執行 `/DDD.spec`
