# 戰鬥系統

這份講引擎：角色怎麼動、一拳怎麼算命中、防禦怎麼判、連段怎麼遞減。**招式內容**在 [角色與招式](fighters-and-moves.md)，**權威數值**在 [模擬核心規格](sim-spec.md)。

主要程式：[`sim/fighter.ts`](../../src/sim/fighter.ts)、[`sim/combat.ts`](../../src/sim/combat.ts)、[`sim/world.ts`](../../src/sim/world.ts)。

## 時間的單位是 tick

**60 tick = 1 秒，而且沒有 delta time。** 模擬每次前進固定一格，永遠不問「距離上一影格過了多久」。

`BattleScene` 用累加器把牆上時間換成整數個 tick：影格長就跑好幾 tick，影格短就一個都不跑。這是為什麼 README 說 **`TPS` 才是重要的數字，不是 `FPS`** — 一台以 16fps 繪製的機器可以完美地跑滿 60 TPS。

所有時間值都以 tick 撰寫，不是毫秒。frame data 才有意義。

## 角色狀態

20 個狀態（[`FighterState.ts`](../../src/fighters/FighterState.ts)）：

```
IDLE  WALK  CROUCH  JUMP  DASH_FORWARD  DASH_BACK
LIGHT_ATTACK  HEAVY_ATTACK  SPECIAL  ULTIMATE  THROW
H_CHARGING                      蓄力特殊技
MEME_IMPACT  MEME_PARRY  MEME_RUSH    三個 meme 招
BLOCK  BLOCKSTUN  HITSTUN  KO  VICTORY
```

三個 meme 招是獨立狀態而不是重用 `LIGHT_ATTACK`，因為 `isAttacking` 對它們必須有不同答案：**招架不是攻擊**，衝刺也不是。

## 一個 tick 裡發生的事

`stepWorld` 的順序是固定的，順序本身就是規則：

```
1. 若 hitStopTicks > 0  →  遞減、tick += 1、直接返回
                            （凍結一切，包含回合計時）
2. 解讀兩邊的輸入        stepFighter × 2
3. 推開重疊              resolvePushCollision
4. 結算戰鬥              stepCombat（判定、實體、大招時間軸）
5. 回合計時遞減
6. 檢查回合結束
```

**hit-stop 凍結整個世界**，不是單邊。這一點是刻意的簡化，也是與 upgraded build 的一個已知差異：那邊攻方與受方分別凍結不同長度，讓打中的一方先解凍，這正是 frame advantage 的來源。這裡沒有，所以那是一個**缺少的機制**而不是缺少的數值 — 大招 cut-in 與回合計時都掛在同一個全域凍結上。

## 判定框

兩種框，全部 AABB，**邊緣相接不算命中**。

**Hurtbox（[`combat.ts:47`](../../src/sim/combat.ts#L47)）**
```
crouching = CROUCH 狀態 || 蹲防 || 蹲下攻擊中
scale     = 變身中 ? 2 : 1
height    = (crouching ? 194 × 0.66 : 194) × scale
width     = 104 × scale
rect(x - width/2, y - height, width, height)
```

從中心向上、向外長，所以腳底永遠貼地。變身放大是玩法而非特效 — 見 [大招與變身](ultimates-and-installs.md)。

**近身 hitbox**
```
reach   = spec.reach × RANGE_MULTIPLIER(rangeStat)
height  = 蹲下攻擊 ? 70 : 100
centerY = y - (蹲下 ? 58 : 空中 ? 100 : 108)
originX = 面向右 ? x + 34 : x - 34 - reach
```

**蹲下不是迴避。** 站立的近身框大約在腳上 58~158，而蹲下的 hurtbox 仍高達 128 — 兩者重疊。蹲下只是把目標變小；跳躍才真的能閃過。

## 防禦

防禦不是按鍵，是**朝對手反方向推**且距離在 340 以內。

一次攻擊有 `attackType`，決定哪種防禦能擋（[`combat.ts:117`](../../src/sim/combat.ts#L117)）：

| attackType | 站防 | 蹲防 |
|---|---|---|
| `low` | ✗ | ✓ |
| `mid` | ✓ | ✓ |
| `overhead` / `air` | ✓ | ✗ |
| `throw` / `unblockable` | ✗ | ✗ |

蹲防的狀態仍是 `BLOCK` 而不是 `CROUCH` — 高度由 `guardCrouching` 帶著，所以判定端讀起來一致。

擋下仍會吃 chip damage（`chipRatio`，多半 0.1）。

## 投技

通用投技是**不可防禦**的，這是給「死守後退不放」那種玩家的答案。

被投的一方有 **5 tick（80 毫秒）** 的解脫窗口：只要在那之前也伸手要投，就算互相拉扯而不是被抓。夠長，讓兩邊差不多同時按下時算作競爭而不是擲骰；夠短，讓按著不放無法當成防投手段。

## 連段遞減

同一段連段裡第 N 下的傷害倍率：

| 第幾下 | 1 | 2 | 3 | 4 | 5 | 6+ |
|---|---|---|---|---|---|---|
| 倍率 | 1.0 | 0.9 | 0.8 | 0.7 | 0.6 | 0.5 |

**大招無論打多深都保底 50%** — 一個當結尾一文不值的大招，沒有人會拿來當結尾。

連段在 **50 tick** 沒有新命中就失效。

## MEME 能量

三種來源：

| 來源 | 數量 |
|---|---|
| 打中 | 依招式 `energyOnHit`，多半 6 |
| 被打中 | 依招式 `energyOnReceive`，多半 3 |
| **按住大招鍵** | 每秒 5（`ULTIMATE_CHARGE_PER_TICK`） |

第三種是唯一「不靠打架」的來源，而且刻意慢 — 空條到滿要 20 秒。它是你在把對手擊倒後那段空檔做的事，不是進攻的替代品。

三個 meme 招（`G+H` 衝擊、`F+H` 招架、`F+G` 突進）也消耗能量，所以滿條時要做選擇。招架不收能量費，它的代價是冷卻 — 否則對任何壓制的正確答案都會變成「按著兩個鍵」。

## Chord（雙鍵招）

`G+H`、`F+H`、`F+G` 的判讀順序**不是偏好，是必要**：Heavy+Special 也是一個 Special，Light+Special 也是一個 Light。先讀單鍵的話，雙鍵組合永遠不可能被辨識。

雙鍵還有一個**寬限窗**：第一顆鍵先到會先打出自己的招，等第二顆到時角色已經在動作中。所以在動作開始後的極短時間內（`CHORD_LENIENCY`，且不超過 startup），chord 可以把那個還沒造成任何影響的動作收回來。它救不了已經揮出去的拳，只救「還在出的路上就被誤判」的那種。

## 其他

- **重疊推開**：兩個站地角色最小間距 86
- **回合**：60 秒、三戰兩勝、intro 67 tick、結束 141 tick
- **輸入緩衝**：8 tick（140 毫秒）。指令以下結尾時，之後幾 tick 仍讀作蹲下
- **角色屬性**：攻擊、射程、控制、速度四項，各自是一條乘數曲線而不是查表

延伸閱讀：[角色與招式](fighters-and-moves.md)、[模擬核心規格](sim-spec.md)。
