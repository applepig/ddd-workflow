---
name: Skill 文件不要逼 agent preflight
description: SKILL.md 的 main flow 應直接指示執行動作，不要求 agent 先驗證 config/host/tool 可用性
type: feedback
originSessionId: a6a522a6-1901-4e59-9d65-cf38b394f1ef
---
Skill 文件的主流程應該讓 agent 直接進入正事，不要強迫 agent 在動手前驗 config 存在、判斷 host 是否有 Monitor / shell、檢查 CLI 是否安裝。這些「能不能跑」的判斷交給底層 script（orchestrator / deploy）——script 失敗時才報錯。

**Why:** 2026-04-15 使用者觀察到跑 `/ddd.xreview` 前，main agent 先檢查 xreview.json config、確認 shell 可用性、確認 Monitor 可用——這些 preflight 把認知資源從 review 本身吸走，反而模糊了任務焦點。原因是 SKILL.md 裡放了大量 host fallback 規則、前提條件、timeout 說明，讓 agent 誤以為自己要先驗環境。

**How to apply:** 寫/改 skill 時：

1. 主步驟只描述「要做什麼」，不描述「怎麼判斷環境能不能做」
2. 前提條件（CLI 安裝、config 存在、host capability）寫成一句話，或整段移到 references/
3. Fallback / troubleshooting / 內部錯誤代碼全進 references/，主流程只留 happy path
4. 禁令要精簡，不要重複解釋「為什麼這條是禁令」的技術細節
5. Trigger description 不要暴露內部實作（e.g. 別寫「以單一 Monitor + shell orchestrator」），改寫成使用者視角的價值
