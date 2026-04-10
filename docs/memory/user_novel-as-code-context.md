---
name: novel-as-code 專案背景與使用者經驗
description: 使用者正在構想互動式連續劇框架，有實際的 LLM 互動敘事開發經驗，但對 drama management 演算法不熟
type: user
---

使用者正在構想 novel-as-code 專案——一個互動式連續劇/小說/RPG 框架。

## 已有的實作經驗

- 嘗試過把完整劇情卡給 LLM 當 GM，結果 2-3 回合就把故事講完（資訊洩漏問題）
- 嘗試過 D20 比率方法：玩家和系統各丟一顆 D20，用 A/(A+B) 決定採用各方意圖的比例，有一些成功
- 了解 LLM 人狼遊戲的資訊不對稱難題

## 產品方向

- 純文字，選項為主 + 可打字 override
- 每個 iteration 約五分鐘份量（1500-2000 字），以 cliffhanger 結尾
- 目標是累積若干回合後產出一份なろう感的網文
- 不追求公式化填充，而是「GM 跟玩家鬥智」——系統有自己的 agenda
- 目標是「讓故事有趣」和「讓故事繼續下去」，避免狗尾續貂感

## 不熟悉的領域

- Drama Manager 演算法（Facade beat sequencing 等）
- Narrative Information Theory（張力量化指標）
- 碎形節奏模型
- 這些需要慢慢討論，不能一次灌太多
