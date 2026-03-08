---
name: DDD.ArchitectRefactor
description: >
  架構層級重構——改善模組邊界、依賴方向、職責分配，非表面 rename/extract。
  Use when the user says "refactor the architecture", "restructure modules",
  "fix module boundaries", "resolve circular dependencies", "improve code
  organization", "this part is getting messy", or invokes "/DDD.architect-refactor".
---

# DDD:architect-refactor — 架構重構

架構層級的重構。不是 rename / extract 等表面整理，而是改善模組邊界、依賴方向、職責分配等結構性問題。

## 嚴格禁令 (Never Do)

- **嚴禁無目標重構**：沒有明確原則指導的重構只是搬家——程式碼換了位置但問題沒變。每次重構必須能回答「這服務什麼設計原則？」。
- **嚴禁跳過影響分析**：架構變動有連鎖效應，漏掉一個下游模組就會在意想不到的地方炸開。涉及 3 個以上檔案的變更，必須先完成影響分析才能動手。
- **嚴禁破壞現有測試**：測試是重構的安全網——如果為了配合重構而修改測試，等於拆掉安全網再走鋼索。測試失敗時必須撤回重構，而非修改測試。

## 執行步驟

1. **現況分析**
   - 閱讀相關程式碼，理解目前的模組結構與依賴關係
   - 產出現況摘要（文字或 Mermaid 依賴圖）
   - 識別問題：職責混亂、依賴方向錯誤、circular dependency、god module 等

2. **架構檢查清單**（重構前必須回答）
   - 這個改動改變了哪些模組的 public interface？
   - Dependency direction 改動後是否仍然正確？
   - 是否引入或消除了 circular dependency？
   - 改動後各模組是否仍可獨立測試？
   - 這個重構服務什麼設計原則？（例：單一職責、依賴反轉、關注點分離）

3. **提出重構方案**
   - 用 AskUserQuestion 向使用者說明：
     - 目前的問題是什麼
     - 建議的目標架構
     - 會影響哪些檔案
     - 預估的風險與副作用
   - 等待使用者確認方向

4. **執行重構**
   - 每一步都先確認測試通過，再進行下一步
   - 優先做結構性改動（移動職責、反轉依賴），而非表面整理
   - 單次 commit 應可被獨立 review

5. **驗收**
   - 所有既有測試通過
   - 產出重構前後的對照摘要
   - 更新 `works.md` 記錄架構決策

## 產出

- 重構後的程式碼（通過所有測試）
- `works.md` 中的架構決策記錄
- Git commits

## 結束條件

使用者確認重構成果，所有測試通過。
