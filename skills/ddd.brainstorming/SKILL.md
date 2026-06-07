---
name: ddd.brainstorming
description: >
  Deprecated：/ddd.brainstorming 已併入 /ddd.plan 的 Deep Planning / Brainstorming 模式。
  遇到 greenfield、from scratch、blank slate、模糊 idea、腦力激盪等需求時，改用 /ddd.plan。
  Trigger: "brainstorm", "explore ideas", "new project", "from scratch", "greenfield",
  "starting a new feature", "turn an idea into a design", "think through this idea",
  "腦力激盪", "新專案", "從頭開始", "新功能起步", "一張白紙", "想法變設計",
  "幫我想清楚", /ddd.brainstorming。
---

# ddd.brainstorming — Deprecated Alias

`/ddd.brainstorming` 已 deprecated。不要維護獨立 brainstorming 流程。

## 替代流程

遇到 greenfield、blank slate、from scratch、模糊 idea、或使用者要求「腦力激盪」時，直接切換到 `/ddd.plan` 的 **Deep Planning / Brainstorming** 強度。

`/ddd.plan` 會以 DDD 版 `grill-with-docs` 流程處理：讀取 PRD、TECHSTACK、既有 sprint docs 與 codebase，沿 decision tree 逐一釐清阻塞決策，最後 chain 到 `/ddd.spec`。

## 執行規則

- 不要在此 skill 內維護第二套流程或產出獨立文件。
- 告知使用者 `/ddd.brainstorming` 已併入 `/ddd.plan`。
- 立即 invoke `/ddd.plan`，並在交接時標註使用 **Deep Planning / Brainstorming** 強度。
- 不要 invoke `/ddd.tasks`、`/ddd.work` 或任何實作 skill。

## 交接句型

> `/ddd.brainstorming` 已併入 `/ddd.plan`。我會用 `/ddd.plan` 的 Deep Planning / Brainstorming 強度，先建立問題定義、domain language、boundary、成功條件與高階設計，再進 `/ddd.spec`。

## 結束條件

`/ddd.plan` 流程完成、使用者確認規格後，依 spec 內 Milestones 複雜度引導使用者執行 `/ddd.work` 或 `/ddd.tasks`。
