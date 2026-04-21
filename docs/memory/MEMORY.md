# Memory Index

## User
- [使用者角色與協作偏好](user_profile.md) — 資深工程師，多 agent 工作流架構師，先討論再實作
- [Novel-as-Code 專案背景](user_novel-as-code-context.md) — 互動敘事實作經驗、產品方向、不熟悉的演算法領域

## Feedback
- [Skill 命名大小寫問題](feedback_skill-naming.md) — Skill tool 用資料夾名配對（小寫），不是 frontmatter name（PascalCase）
- [派工要 atomic + 依序](feedback_atomic-task-dispatch.md) — sub-agent 一次做一 chunk，大包派工會中途 token 爆
- [真實測試用小模型](feedback_test-with-small-models.md) — e2e/smoke 用 haiku/flash/mini，旗艦模型留給正式 review
- [Skill 文件不要逼 agent preflight](feedback_skill-no-preflight.md) — 主流程只描述動作，環境判斷交給底層 script

## Project
- [xreview reviewer 重構完成](project_xreview3-upgrade.md) — review-prompt.md 已刪除，整合進 ddd-reviewer agent（2026-04-08）
- [Multi-platform build 已完成](project_multi-platform-build.md) — build.js 已合併到 main，deploy 架構改為 Claude 直接 symlink + 其他平台走 dist/
