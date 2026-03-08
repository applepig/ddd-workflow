---
name: DDD.Xwrap
description: >
  收工——最終檢查、文件驗收、推送分支，準備建立 PR。
  Use when the user says "wrap up", "finish the feature", "do final checks",
  "prepare for PR", "push the branch", "we're done", "ship it",
  or invokes "/DDD.xwrap". Use when all milestones are complete.
---

# DDD:xwrap — 收工

收工階段。進行最終檢查、確保文件完整、推送分支準備 PR。

## 執行步驟

1. **任務完整性檢查**
   - 檢查 `tasks.md` 確認所有項目皆已勾選 (`- [x]`)。
   - 執行專案的完整測試套件（如 `pnpm test`），確認 100% 通過。

2. **文件完整性檢查**
   - 核對 `spec.md`：確認所有驗收條件皆已滿足。
   - 核對 `works.md`：確認已記錄開發過程中的關鍵技術決策。

3. **程式碼品質檢查**
   - 使用 `rg "TODO|FIXME|console\.log" --glob '!node_modules' --glob '!dist'` 檢查專案目錄。若發現遺留物，必須先清除再繼續。
   - 執行專案的 Lint 指令（如 `pnpm lint`），確認無語法錯誤或未使用的變數。

4. **Git 狀態確認**
   - 執行 `git status` 確認沒有未提交的變更。
   - 若有未提交的變更，先請使用者確認是否需要額外 commit。

5. **推送與報告**
   - 用 AskUserQuestion 向使用者確認：「所有檢查已通過，是否要推送分支？」
   - 使用者同意後，執行 `git push -u origin HEAD` 推送當前分支。
   - 在對話中產出 Markdown 格式的 Sprint 摘要報告：
     - **完成摘要**：一句話總結完成了什麼。
     - **關鍵決策**：實作中遇到的最大困難與解法。
     - **後續建議**：有無技術債或未來可擴充的方向。

## 產出

- 推送到遠端的 feature branch
- Sprint 摘要報告（在對話中呈現）

## 結束條件

分支推送完成，使用者可以建立 Pull Request。
