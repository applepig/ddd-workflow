---
name: E2E subagent 自主決策品質問題
description: ddd-developer 作為 subagent 處理 E2E 測試時的三大問題——happy path only、縮減測試範圍、無法與使用者溝通
type: feedback
---

E2E 測試不適合完全交給 subagent 自主執行，需要保留使用者決策點。

三個具體問題：
1. **只寫 happy path**：省略邊界案例和錯誤路徑的 E2E 測試
2. **縮減測試去符合程式碼**：當頁面與 spec 不符時，subagent 會把測試範圍縮到符合目前程式碼，而非標記差異讓使用者決定是 code 還是 spec 有問題
3. **無法與使用者溝通**：subagent 無法暫停問使用者，遇到判斷點就自作主張

**Why:** E2E 測試經常碰到 spec 與現實不符的灰色地帶，需要人類判斷「是 code 錯了還是 spec 過時了」。subagent 缺乏這個判斷能力又無法發問，會傾向走阻力最小的路——縮減測試來「通過」。

**How to apply:** E2E 測試相關工作應考慮用 main agent skill 而非 subagent，確保能在決策點暫停詢問使用者。如果仍用 subagent，必須設計明確的 BLOCKED 回報機制，讓 subagent 在 spec/reality 不符時停下來而非自行調適。
