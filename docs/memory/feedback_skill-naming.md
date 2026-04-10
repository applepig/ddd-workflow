---
name: Skill 命名大小寫問題
description: Claude Code Skill tool 用資料夾名稱配對（小寫），不是 frontmatter name（PascalCase），導致 DDD.tasks 失敗但 ddd.tasks 成功
type: feedback
---

Claude Code 的 Skill tool 用**資料夾名稱**（小寫）配對，不是 frontmatter `name` 欄位（PascalCase）。這導致 `Skill(DDD.tasks)` 失敗但 `Skill(ddd.tasks)` 成功。

**Why:** 我們的 SKILL.md frontmatter 用 `name: DDD.Tasks`（PascalCase），但 Skill tool 實際配對的是資料夾名稱 `ddd.tasks`。CLAUDE.md 和 skill description 中寫 `/DDD.tasks` 引導 LLM 用錯誤的大小寫呼叫。官方規範說 `name` 欄位應是小寫 + 數字 + 連字號（kebab-case），dots 和大寫都在規範外。

**How to apply:**
- 呼叫 Skill tool 時一律用小寫資料夾名稱：`ddd.tasks`、`ddd.work`、`ddd.xreview`
- 文件和 description 中的 trigger phrase 也應寫小寫形式
- 長期可能需要將 frontmatter `name` 改成跟資料夾一致，避免 Anthropic 未來加嚴格驗證時壞掉
- 相關 issue：anthropics/claude-code#26436（短名稱 Unknown skill）、anthropics/claude-plugins-official#322（name 有空格導致截斷）
