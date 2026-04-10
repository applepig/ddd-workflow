---
name: 使用者角色與協作偏好
description: 資深工程師，專注多 agent CLI 工作流架構設計，重視 context window 效率，偏好先討論架構再實作
type: user
---

## 角色

資深軟體工程��，同時維護多個 AI agent CLI 工具的共用工作流（Claude Code、Gemini CLI、OpenCode）。日常工作橫跨 DDD workflow skill 設計、cross review 流程、CLI 工具開發（如 claude-r tmux session picker）。

## 協作風格

- 先討論架構方向，列出 trade-off，再決定實作路線——不喜歡直接跳進去寫
- 會主動帶著具體提案來討論（通常列點 1、1-2、1-3 這種分支結構），期待對方逐點回應
- 重視 context window 是稀缺資源——skill 設計上會考慮如何減少 prompt 重複、降低 token 消耗
- 實際使用中遇到的問題會帶回來改 skill（如 worker 跳過測試、xreview path 解析錯誤）

## 技術偏好

- 偏好 shell script 作為薄 wrapper，不喜歡過度框架化
- 評估工具時考慮「設定複雜度 vs 能力」的 trade-off（如 opencode 有 tool use 但設定複雜、aichat 零設定但無 tool use）
- 熟悉 git subtree、symlink 部署、tmux 工作流
