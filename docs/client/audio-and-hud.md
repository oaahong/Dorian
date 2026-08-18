# 音效、HUD 與特效

三個表現層系統，都在線的「隨便亂來」那一側。

## 音效：沒有任何音檔

[`systems/AudioManager.ts`](../../src/systems/AudioManager.ts) 用 `AudioContext` 振盪器**即時合成**每一個聲音。整個專案沒有一個 `.mp3` 或 `.wav`。

這帶來幾個結果：

- 零下載成本、零載入時間
- 音色由參數決定，改一個數字就改一個聲音
- 遊戲有一種一致的、刻意廉價的質感 — 跟低解析度迷因貓卡是一套的

`M` 靜音。

**大招語音是 upgraded build 規劃了但不存在的東西。** 那邊的資料裡每個角色都有一個 `voiceAudio` 鍵（`ult_alien_voice` 之類），但**沒有任何程式讀它**：沒有片段被載入、`source-assets` 和管線封存裡也沒有任何檔案。那些鍵是某個人寫下的計畫，不是功能。要移植它，得先有人把那些台詞錄出來。

## HUD

[`ui/BattleHUD.ts`](../../src/ui/BattleHUD.ts) 每影格**直接讀 `SimWorld`**。

計時顯示的秒數由 tick 計數推導，不是讀牆上時鐘 — 所以螢幕上的數字永遠和模擬認為的一致。

組成：血條（[`HealthBar.ts`](../../src/ui/HealthBar.ts)）、MEME 能量條（[`MemeMeter.ts`](../../src/ui/MemeMeter.ts)）、回合計時、勝場指示。

**所有角色顯示的血量都是 100。** `hpStat` 影響傷害減免與角色身分，不改變可見的血量上限。

## 特效

[`systems/VFXManager.ts`](../../src/systems/VFXManager.ts) 提供一組可重用的基本效果，大招演出與戰鬥表現都用它，不各自重寫：

`hitSpark` `blockSpark` `shockwave` `speedLines` `afterimage` `pixelBlocks` `popup` `memePopup` `flash` `shake` `ultimateBackdrop`

## `F2` 除錯疊層

顯示判定框、受擊框，以及一行狀態：

```text
NET ok delay=4 stalled=0
FPS 60.0  TPS 60.0  TICK 431  PHASE fight
```

**`TPS` 才是連線時重要的數字，不是 `FPS`。** 一個客戶端可以用 16 fps 繪製，同時完美地模擬 60 tick/秒 — 因為固定步長累加器一影格會跑好幾 tick。一場被連線拖住的比賽在 `FPS` 上看起來很健康，卻不能玩。

健康的比賽讀作 `NET ok` 與 `TPS 60`；其他任何值都在指出是哪一部分出問題。

怎麼讀這一行的完整說明在 [連線建立與除錯](../networking/connection-and-debugging.md)。

## upgraded build 的除錯疊層沒有移植

那邊有一個掛在戰鬥場景上、可切換的除錯疊層，顯示 startup/active/recovery 階段、frame advantage、生效中的狀態與目前的大招節拍。

它是開發工具，而且是接好線的那種 — 值得日後補上，但對玩家一文不值。目前在 README 的「Not ported」清單上。

延伸閱讀：[渲染層](rendering.md)、[場景流程](scene-flow.md)。
