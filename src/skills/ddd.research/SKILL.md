---
name: DDD.Research
description: >
  This skill should be used when the user asks to "research a technology",
  "investigate feasibility", "compare technical options", "do a PoC",
  "evaluate libraries", or invokes "/DDD.research". Use when there are open
  technical questions that need answers before writing a spec — such as
  API limitations, performance characteristics, or library comparisons.
---

# DDD:research — 技術調研

技術調研階段。用於驗證可行性、比較方案、產出技術結論，為撰寫 spec 做準備。

## 嚴格禁令 (Never Do)

- **嚴禁修改正式程式碼**：PoC (Proof of Concept) 測試程式碼必須放在暫存位置或獨立分支，絕對不可直接修改專案的主要 codebase。
- **嚴禁過度設計**：調研應專注於回答「待釐清事項」，不要花時間刻意最佳化或重構 PoC 程式碼。

## 執行步驟

1. **確認調研範圍**
   - 讀取現有的 `plan.md`（如果有的話）
   - 用 AskUserQuestion 確認：
     - 要調研哪些具體問題？
     - 有沒有偏好的技術方向？
     - 調研深度：快速驗證 or 完整比較？

2. **進行調研**
   - 閱讀相關程式碼、文件、`docs/TECHSTACK.md`
   - 如有需要，撰寫 PoC（Proof of Concept）程式碼進行驗證
   - PoC 程式碼放在暫存位置，不進入正式程式碼庫

3. **撰寫 research.md**（維持以下大綱結構）
   - **調研目標 (Objectives)**：要回答什麼問題、驗證什麼假設
   - **調研內容與發現 (Findings)**：記錄測試過程、API 限制、效能數據等
   - **方案比較 (Comparisons)**：如果有多個方案，列出優缺點比較
   - **結論與建議 (Conclusion & Recommendation)**：給出明確的技術建議與後續實作方向

4. **交付**
   - 將 research.md 呈現給使用者
   - 根據回饋調整結論

## 產出

`docs/<編號>-<名稱>/research.md`

## 結束條件

使用者確認調研結論後，引導使用者執行 `/DDD.spec`。
