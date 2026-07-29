---
name: ddd.plan
description: >
  前置規劃：寫 spec 前，用 PRD、TECHSTACK、既有 sprint 文件與 codebase stress-test
  使用者的 idea / rough plan，沿 decision tree 逐一釐清阻塞決策。
  需求模糊、方向未定、或需要 domain language / 技術方向校準時使用；需求已明確直接走 /ddd.spec；完成後 chain 到 /ddd.spec。
  Trigger: "plan a feature", "plan an extension", "clarify requirements",
  "brainstorm", "explore ideas", "from scratch", "greenfield",
  "規劃擴充", "規劃改動", "規劃功能", "釐清需求", "腦力激盪", "從頭開始", /ddd.plan。
---

# ddd.plan — DDD Grill with Docs

`/ddd.plan` 是 spec 前的探索與校準流程。它把使用者的 idea / rough plan 對照 `PRD.md`、`TECHSTACK.md`、既有 sprint 文件與 codebase，沿著 decision tree 逐一釐清阻塞決策，防止 domain drift、技術方向漂移與 scope 膨脹。

Docs/code 校準與 Reuse Map 是本 skill 的必要產出；取得這些資訊時依 AGENTS.md「角色分工」路由，本 skill 不重述探索派工判準。

完成後直接 chain 到 `/ddd.spec`。

<HARD-GATE>
嚴禁撰寫程式碼或修改專案設定檔，直到 spec.md 獲使用者確認。
嚴禁自行假設商業邏輯，需求模糊時必須提問。
嚴禁跳過 docs/code 校準直接產 spec。
方向涉及新建 function / 元件 / 樣式時，必須先取得既有可複用資產盤點，帶入 spec 的「既有資產盤點 / Reuse Map」。
</HARD-GATE>

## 工作強度

依需求模糊度與既有 anchor 自動選擇 grilling intensity：

- **Light Planning**：需求大致明確，只缺少少數決策或 scope 邊界。快速查 docs/code、補 1-3 個阻塞決策後進 `/ddd.spec`。
- **Standard Planning**：需求有多個可行方案，或必須理解既有 code / docs 才能決策。沿 decision tree 逐題收斂，提出 2-3 個方案與推薦。
- **Deep Planning / Brainstorming**：沒有可靠 codebase anchor，或使用者只有模糊 idea。先建立問題定義、domain language、boundary、成功條件與高階設計，再收斂到 `/ddd.spec`。

差異不在產出文件，而在探索深度：Light / Standard 是「在既有脈絡中收斂」，Deep 是「從不完整 idea 建立脈絡再收斂」。

## DDD 文件對應

`grill-with-docs` 的 I/O 對應到 DDD 文件：

| grill-with-docs | DDD 對應 |
|---|---|
| 使用者 plan | 使用者 idea / feature request / rough plan |
| `CONTEXT.md` glossary | `docs/PRD.md` 的 Domain Language / Product Context |
| ADRs | `docs/TECHSTACK.md` 的 project-level 技術決策，或 sprint `spec.md` 的 ADR |
| codebase cross-reference | 既有 source、既有 sprint docs、README |
| inline update `CONTEXT.md` | 必要時依文件職責更新 `PRD.md`、`TECHSTACK.md` 或 `research.md` |
| refined plan | 交接摘要，直接進 `/ddd.spec` |

## Checklist

1. **讀取 DDD anchor** — 讀 `docs/PRD.md`、`docs/TECHSTACK.md`、相關 sprint docs、README，並取得相關 code context
2. **選擇工作強度** — 判斷 Light / Standard / Deep，並向使用者簡短說明目前判斷
3. **解析 decision tree** — 找出會阻塞設計的 domain、scope、technical、UX、data、migration、testability 決策
4. **逐一 grill** — 一次只問一個阻塞決策；每題都給推薦答案；可查證的事實先查明，不問使用者
5. **對照 docs/code** — 檢查使用者說法是否與 PRD、TECHSTACK、既有 spec、ADR、code 相衝突
6. **必要時更新輔助文件** — 依文件職責更新 PRD、TECHSTACK 或 research.md
7. **需求完整性與可複用資產摘要** — 回溯對話，確認需求、約束、偏好都會帶入 `/ddd.spec`；並把 code 探索結果中的可複用 utility / 元件 / 樣式 token 整理成清單，帶入 spec 的「既有資產盤點 / Reuse Map」
8. **接續 `/ddd.spec`** — invoke `/ddd.spec`，將規劃結論填入 spec 的背景、驗收條件、ADR 與 Milestones

## Grilling 規則

- **Decision tree 優先**：不要跑固定問題清單。沿著目前需求的決策樹前進，每次只處理一個會阻塞設計的分支。
- **推薦答案必填**：每個決策題都要包含已知事實、2-3 個選項、Coordinator 的推薦選項與理由。
- **Question Tool**：真正需要使用者決策時，用 Question Tool，不用一般文字問句代替。
- **不設問題上限**：簡單需求可能 1-2 題，Deep Planning 可能很多題。若使用者要求收斂，立即摘要目前決策與剩餘風險，進入 `/ddd.spec`。
- **避免低價值問題**：不要問命名、路徑、技術棧等可由 docs/code 推得的細節；不要重複問已決定的分支。

## Domain / Docs 校準

### Challenge against PRD language

當使用者用詞和 `PRD.md` 的 domain language 衝突時，立即指出：

> PRD 目前把「Customer」定義為下單者，但你剛剛說的「Customer」似乎是付款帳號。這兩個要合併還是分開？

若使用者使用模糊或 overloaded term，提出 canonical term：

> 你說「account」時，是指登入用的 User，還是付款/組織層級的 Billing Account？我建議這裡用 Billing Account，避免和 auth User 混淆。

### Cross-reference with code

當使用者描述「現在系統如何運作」時，查 code 或既有文件驗證。若發現矛盾，先 surface contradiction，再請使用者決策：

> 你說可以 partial cancellation，但目前 code 只取消整筆 Order。這次要改 domain model 支援 partial cancellation，還是維持整筆取消？

### Discuss concrete scenarios

用具體情境 stress-test domain boundary，不要停在抽象描述：

- 空資料、重複提交、權限不足、跨 tenant、partial failure
- 舊資料 migration、外部 API timeout、背景 job 重試
- 使用者取消、回復、修改已完成狀態的情境

## 文件更新規則

`/ddd.plan` 可以在規劃過程中更新輔助文件，取捨依 AGENTS.md「文件結構與職責」；技術調研細節進 `research.md`，sprint-specific implementation detail 進該 sprint 的 `spec.md`。

## ADR 判斷

只有三者都成立才建議寫 ADR：

1. **Hard to reverse**：改變成本高
2. **Surprising without context**：未來維護者會問「為什麼這樣做？」
3. **Real trade-off**：真的有替代方案且做了取捨

Project-level ADR 放在 `TECHSTACK.md` 或其連結的 ADR；sprint-specific tradeoff 放在該 sprint 的 `spec.md` ADR。

## 結束條件

`/ddd.spec` 流程完成、使用者確認規格後，依 spec 內 Milestones 複雜度引導使用者執行 `/ddd.work` 或 `/ddd.tasks`。

若中途需要收斂但尚未進入 `/ddd.spec`，先以**該輪最終訊息**輸出目前已確認決策、未解風險、建議下一步，讓使用者讀完；下一輪才用 Question Tool 讓使用者選擇繼續 grill 或進 spec。同輪送出時，工具呼叫前的文字不會顯示，使用者會沒讀到報告就面對問題。
