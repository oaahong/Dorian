# 場景流程

Phaser 場景圖：從開機到打完一場。程式在 [`src/scenes/`](../../src/scenes/)。

## 流程

```
BootScene
 └─> TitleScene              按任意鍵
      └─> ModeSelectScene    1P VS CPU / 2P VS P2 / ONLINE VS / TRAINING
           │
           ├─ 離線三種 ─> CharacterSelectScene
           │                └─> PrepareMatchScene   載入兩位角色的資產
           │                     └─> VsScene        對戰卡，約 1.75 秒
           │                          └─> BattleScene
           │                               └─> ResultScene
           │                                    ├─> PrepareMatchScene（再打一場）
           │                                    ├─> CharacterSelectScene（換角）
           │                                    └─> ModeSelectScene
           │
           └─ ONLINE VS ─> OnlineLobbyScene   建房或輸入房號
                            └─> PrepareMatchScene ─> VsScene ─> BattleScene
                                 └─> ResultScene ─> OnlineLobbyScene
```

`Esc` 在多數場景是往回一層。戰鬥中 `Esc` 是暫停 — 但**連線時是離開比賽**，因為暫停會讓對手無限期卡住。

## 各場景職責

| 場景 | 做什麼 |
|---|---|
| `BootScene` | 載入選單所需的最小資產（縮圖，非全解析度卡片），然後轉場 |
| `TitleScene` | 標題。任意鍵繼續 |
| `ModeSelectScene` | 四個模式。1P 另外選難度 |
| `CharacterSelectScene` | 12 人格線，4 欄 × 3 列 |
| `OnlineLobbyScene` | 房號配對，見 [連線建立與除錯](../networking/connection-and-debugging.md) |
| `PrepareMatchScene` | **只載入這兩位角色需要的東西**，帶進度條 |
| `VsScene` | 對戰卡 |
| `BattleScene` | 擁有模擬，以固定步長驅動它 |
| `ResultScene` | 勝負，以及接下來要做什麼 |

## `BattleScene` 是唯一有迴圈的

它**不含任何玩法邏輯**。每影格它做四件事：

```
1. 取樣輸入        KeyboardSampler → 一個 16-bit 字
2. 問 session      「這個 tick 可以跑了嗎？」
3. 推進模擬        stepWorld(world, [p1, p2]) → SimEvent[]
                   （累加器決定這一影格跑幾個 tick，可能是 0 個，也可能是好幾個）
4. 交給 view       BattleView.render(world, events)
```

第 2 步就是整個連線功能藏身之處 — 見 [架構總覽](../architecture.md#為什麼-session-是整個連線功能的接縫)。

**固定步長累加器**是為什麼 `TPS` 比 `FPS` 重要：影格長就補跑好幾 tick，所以一台繪製很慢的機器仍能維持完美的模擬速率。

## 選角格線

`GRID` 是**一份定義**，版面、游標環繞與高亮全部由它推導。要加第十三個角色，改那一個物件。

它原本是 4×2 的大格子，第三列在 720px 的舞台上會掉出畫面外 — 所以是**格子縮小**而不是把名單分頁。

## 兩件關於鍵盤輸入的事

**選單與大廳一律用實體 `KeyboardEvent.code`，不是 `event.key`。** 在中日韓輸入法啟用時 `event.key` 可能送來組字文字 — 原本的選角畫面就是這樣壞掉的。房號輸入尤其吃這一點。

**選單場景在 `create()` 時會設一道約 300 毫秒的輸入鎖。** 讓你進入這個場景的那次按鍵，不會直接穿過去觸發下一個場景。e2e 測試必須尊重它，否則按鍵會被無聲吞掉（[`e2e/helpers.ts`](../../e2e/helpers.ts) 的 `pressAfterInputUnlock`）。

## 資產載入策略

`PrepareMatchScene` 只載入**這兩位角色**需要的東西：

| | 數量 | 大小 |
|---|---|---|
| 姿勢圖 | 2 × 20 | 小 |
| 技能圖 | 兩張完整技能表 | 約 2.8 MB |
| 大招背景 | 2 | 約 5 MB |

不在開機時載入，因為十二張背景是 30 MB 而一場比賽只需要兩張。也因為**連線時兩個玩家要等比較慢的那一個**，所以載入量直接影響開賽速度。

跨場景的比賽設定（模式、角色、難度）走 [`systems/GameState.ts`](../../src/systems/GameState.ts)；連線的 session 走 [`net/onlineMatch.ts`](../../src/net/onlineMatch.ts) — 因為 Phaser 場景由框架建構，不能帶參數。

延伸閱讀：[渲染層](rendering.md)、[美術資產與管線](art-pipeline.md)。
