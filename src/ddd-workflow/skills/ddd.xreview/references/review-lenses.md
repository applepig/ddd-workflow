# Review Lenses

`ddd-reviewer` 的 agent definition 是主要契約。本文件提供各 lens 的補充 checklist；不要把 checklist 當成必須逐項回報的格式。只回報有具體失敗場景、證據與修正建議的問題。

## Docs Lens

適用於只有文件變更，或文件本身也需要被審查的情境。

- 規格一致性：目標、非目標、User Story、驗收條件、ADR、Milestones 是否互相矛盾
- 可測性：驗收條件是否能轉成 unit、integration 或 E2E test；是否缺少可觀察結果
- Edge case：錯誤狀態、空資料、權限、重試、partial failure、相容性、migration 是否影響需求
- Scope：是否混入 sneaky feature、過早抽象，或把「以後可能需要」寫進本 sprint
- 決策紀錄：重要 tradeoff 是否有 ADR 或明確決策，而不是只描述結論

## Spec Lens

適用於有實作且有 spec 或已確認 task source 的情境。

- 規格符合度：實作是否符合目標、非目標、驗收條件與 ADR
- 任務完成度：任務來源是否真的完成，有無只完成 happy path
- Scope drift：是否做了 spec 沒要求的行為，增加使用者可見風險或維護成本
- 測試對應：重要驗收條件與 edge case 是否有測試覆蓋
- SSOT 同步：實作若改變需求或行為，文件是否同步更新

## Code Lens

適用於有 production code 變更的情境。

- Correctness：資料流、狀態轉移、錯誤處理、null、timeout、stale state 是否會造成錯誤行為
- 資料安全：資料遺失、損壞、重複、不可逆變更、migration 或 schema drift 風險
- Failure mode：retry、rollback、partial failure、冪等性、race condition、re-entrancy 是否安全
- 相容性：既有 API、持久化資料、外部 consumer、版本偏移是否被破壞
- DRY 風險：只回報會造成 business rule 分歧、validation/permission 漏改、或測試覆蓋不一致的重複邏輯
- 可觀測性：故障是否會被 log、metric、error boundary 或 user-visible state 隱藏

## Security Lens

適用於有 production code 變更的情境。

- AuthN/AuthZ：認證、權限、role、tenant isolation 是否可被繞過
- Trust boundary：user input、external API、webhook、file upload、CLI args、env 是否被直接信任
- Injection：SQL、command、template、XSS、path traversal、open redirect 是否有具體路徑
- Secrets：token、key、credential 是否可能進入 log、error、client bundle 或 repo
- Data exposure：API response、cache、export、debug output 是否過度暴露資料
- Abuse path：rate limit、resource exhaustion、重複提交、background job 是否可被濫用
- Supply chain：新增 dependency、script execution、download/exec path 是否擴大攻擊面
