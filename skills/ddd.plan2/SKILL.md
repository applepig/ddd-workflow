---
name: ddd.plan2
description: >
  ddd.plan 的實驗改版（A/B 驗證中）：grilling 迴圈升為 skill 主體，程序性工作壓縮為前置與收尾；
  工作強度預設 Standard、降級 Light 需經使用者同意，每個阻塞決策以具體情境 stress-test 收斂。
  僅在使用者明確指名 plan2 或 /ddd.plan2 時使用；一般前置規劃需求走 /ddd.plan。
  Trigger: /ddd.plan2。
---

# ddd.plan2 — DDD Grill（主迴圈版）

`/ddd.plan2` 是 spec 前的探索與校準流程。把使用者的 idea / rough plan 對照 `PRD.md`、`TECHSTACK.md`、既有 sprint 文件與 codebase，沿 decision tree 逐一釐清阻塞決策，防止 domain drift、技術方向漂移與 scope 膨脹。完成後直接 chain 到 `/ddd.spec`。

與 `/ddd.plan` 的差異（實驗假設：v1 的程序性內容稀釋了 grilling 深度，且強度自選提供了淺挖出口）：

- Grilling 迴圈是本 skill 的主體；讀 anchor、Reuse Map、文件更新壓縮為前置與收尾。
- 工作強度預設 Standard；降級 Light 必須向使用者呈報剩餘決策清單並取得同意。
- 每個阻塞決策以「具體情境 stress-test 通過、能落到明確的 SSOT 條文」為收斂條件，不以「問過了」為收斂條件。
- Deep 強度收斂為建立「問題定義、domain language、boundary、成功條件」，不含 v1 的「高階設計」產出。
- 移除 grill-with-docs 對應表。

<HARD-GATE>
嚴禁撰寫程式碼或修改專案設定檔，直到 spec.md 獲使用者確認。
嚴禁自行假設商業邏輯，需求模糊時必須提問。
嚴禁跳過 docs/code 校準直接產 spec。
方向涉及新建 function / 元件 / 樣式時，必須先取得既有可複用資產盤點，帶入 spec 的「既有資產盤點 / Reuse Map」。
</HARD-GATE>

## 前置（一次完成）

1. **讀 DDD anchor**：`docs/PRD.md`、`docs/TECHSTACK.md`、相關 sprint docs、README，並取得相關 code context——探索與 research 依 AGENTS.md「角色分工」路由，本 skill 不重述派工判準。
2. **選擇工作強度，預設 Standard**：
   - **Standard**：沿 decision tree 逐題收斂（主迴圈）。
   - **Light**（需使用者同意）：認為只剩少數決策時，先以**該輪最終訊息**輸出「我判斷只剩這 1–3 個阻塞決策」清單與依據，下一輪才用 Question Tool 徵求降級同意——同輪送出時工具呼叫前的文字不會顯示，清單會被吞掉。經同意才以短迴圈收斂。
   - **Deep**：沒有可靠 codebase anchor 或只有模糊 idea 時，先建立問題定義、domain language、boundary 與成功條件，再進主迴圈。

## Grilling 主迴圈

每輪處理**一個**阻塞決策，直到 decision tree 上沒有未收斂的阻塞分支：

1. **選分支**：挑當前最阻塞設計的決策（domain、scope、technical、UX、data、migration、testability）。
2. **先查證**：可由 docs/code 推得的事實自行查明，不問使用者；不問命名、路徑、技術棧等可推得細節，不重問已定分支。
3. **對照校準**：使用者的說法與 PRD domain language、既有 spec/ADR、code 現況衝突時，先 surface contradiction 再請使用者決策：

   > PRD 目前把「Customer」定義為下單者，但你剛剛說的「Customer」似乎是付款帳號。這兩個要合併還是分開？

   > 你說可以 partial cancellation，但目前 code 只取消整筆 Order。這次要改 domain model 支援，還是維持整筆取消？

   使用者使用模糊或 overloaded term 時，提出 canonical term 建議：

   > 你說「account」時，是指登入用的 User，還是付款／組織層級的 Billing Account？我建議這裡用 Billing Account，避免和 auth User 混淆。

4. **具體情境 stress-test**：至少用一個具體情境逼出決策邊界——空資料、重複提交、權限不足、跨 tenant、partial failure、舊資料 migration、外部 API timeout、使用者取消／回復已完成狀態。走不下去的位置就是下一個 grill 點。
5. **提問**：用 Question Tool，附已知事實、2–3 個選項、推薦選項與理由。
6. **收斂判準**：這個決策能落到明確的 SSOT 條文——spec 的驗收條件、非目標、介面／邊界案例、ADR，或 PRD／TECHSTACK 更新——才算收斂；落不了，代表還沒問到底。

不設題數上限。使用者要求收斂時，立即摘要已確認決策與剩餘風險，進入收尾。

## 收尾（迴圈結束後一次完成）

1. **需求完整性回溯**：回溯對話，確認需求、約束、偏好都會帶入 `/ddd.spec`。
2. **Reuse Map**：把 code 探索結果中的可複用 utility / 元件 / 樣式 token 整理成清單，帶入 spec 的「既有資產盤點 / Reuse Map」。
3. **必要時更新輔助文件**：取捨依 AGENTS.md「文件結構與職責」；技術調研細節進 `research.md`，sprint-specific implementation detail 進該 sprint 的 `spec.md`。
4. **ADR 判斷**：三者都成立才建議寫 ADR——hard to reverse、surprising without context、real trade-off。Project-level 放 `TECHSTACK.md` 或其連結的 ADR，sprint-specific 放該 sprint 的 `spec.md` ADR。
5. **接續 `/ddd.spec`**：invoke `/ddd.spec`，將規劃結論填入 spec 的背景、驗收條件、ADR 與 Milestones。

## 結束條件

`/ddd.spec` 流程完成、使用者確認規格後，依 spec 內 Milestones 複雜度引導使用者執行 `/ddd.work` 或 `/ddd.tasks`。

若中途需要收斂但尚未進入 `/ddd.spec`，先以**該輪最終訊息**輸出目前已確認決策、未解風險、建議下一步，讓使用者讀完；下一輪才用 Question Tool 讓使用者選擇繼續 grill 或進 spec。同輪送出時，工具呼叫前的文字不會顯示，使用者會沒讀到報告就面對問題。
