# 模擬核心規格

模擬做什麼，以及每條規則為什麼長這樣。

最初是讀著重構前的 Phaser 實作寫出來的，當作要取代它的那批測試的依據。移植已經完成，所以這份現在是 `src/sim` 的**權威參考** — 但敘事角度保留了下來：**看起來武斷的數字，就是武斷的**，記在這裡是為了讓改動它成為一個決定，而不是一場意外。

每條規則都指向它所在的程式。容易被誤認成 bug 的地方會特別標出來，因為其中有好幾條真的很像。

> **決定性規則：逐運算式照搬公式。** `0.85 + stat * 0.07` 算出來是 `0.9199999999999999`，不是 `0.92`。改寫成 `(85 + stat * 7) / 100` 會改變低位元 — 離線看不出來，連線就是 desync。

---

## 1. 世界常數

出自 [src/sim/constants.ts](../../src/sim/constants.ts)。`src/utils/constants.ts` 為 Phaser 端再匯出這些值，自己只保留顏色與字型。

| 常數 | 值 | 註 |
|---|---|---|
| `TICK_HZ` / `DT` | 60 / `1/60` | `DT` 是**常數**，永遠不是量出來的影格間隔 |
| `GAME_WIDTH` × `GAME_HEIGHT` | 1280 × 720 | 所有幾何都用這個單位 |
| `GROUND_Y` | 610 | 角色腳底停在這 |
| `ARENA_MIN_X` / `ARENA_MAX_X` | 95 / 1185 | 角色 `x` 的硬夾限 |
| `GRAVITY` | 1750 px/s² | |
| `JUMP_VELOCITY` | −690 px/s | 約 47 tick 滯空 |
| `ROUND_TICKS` | 3600 | 60 秒 |
| `INPUT_BUFFER_TICKS` | 8 | 蹲下緩衝，讓以下結尾的指令之後幾 tick 仍讀作蹲下 |
| `FIGHTER_HURTBOX_WIDTH` / `_HEIGHT` | 104 / 194 | |
| `INSTALL_BODY_SCALE` | 2 | 變身角色的身體與 hurtbox |
| `PUSH_APART_DISTANCE` | 86 | 站地角色的最小間距 |
| `P1_SPAWN_X` / `P2_SPAWN_X` | 350 / 930 | 面向 `+1` 與 `−1`，每回合重置 |

導出表：

- `SPEED_BY_STAT` = `{1:235, 2:255, 3:280, 4:310, 5:340}` px/s
- `ATTACK_MULTIPLIER(stat)` = `0.85 + stat * 0.07`
- `RANGE_MULTIPLIER(stat)` = `0.88 + stat * 0.055`
- `CONTROL_RECOVERY_MULTIPLIER(stat)` = `1.05 - stat * 0.025` — 攻擊收招
- `CONTROL_COOLDOWN_MULTIPLIER(stat)` = `1.08 - stat * 0.025` — 特殊技冷卻
- `HP_STAT_MITIGATION(stat)` = `1.08 - stat * 0.03`

**`1.05` / `1.08` 的差異是真的。** 兩條不同的控制曲線，一條給收招一條給冷卻，繼承自原版且刻意保留。**這不是可以順手統一掉的筆誤。**

**`STUN_FRICTION_PER_TICK` 是字面值，不是運算。** 原版寫的是 `vx *= Math.pow(0.0015, dt)`。`Math.pow` 在各 JavaScript 引擎之間不保證位元相同，所以它不能出現在模擬裡；而固定步長讓指數變成常數，整個呼叫塌縮成 `0.89729418715708964`。`constants.test.ts` 是這個字面值與 `Math.pow` 唯一被允許碰面的地方。

---

## 2. 輸入

網路承載是**每位玩家每 tick 一個 16-bit 的原始按鍵字**（[src/sim/input.ts](../../src/sim/input.ts)）：

```
bit 0 左    bit 1 右    bit 2 上    bit 3 下
bit 4 輕擊  bit 5 重擊  bit 6 特殊  bit 7 投  bit 8 大招
```

在 upgraded build 的操作方案進來之前，它是一個 byte 還多一位。那套方案需要投技鍵和專用大招鍵 — 九位元，塞不進八位。把方向壓成 4-bit 的九宮格值可以把那一位換回來，代價是 `moveAxis` 和防禦判定要在熱路徑上解一個欄位而不是測一個位元，只為了每 tick 省一個 byte。

**任何導出的東西都不上線。** 按鍵邊緣、是否防禦、打出了哪個指令，全部在模擬內重算 — 所以對同一批位元組重跑一次，會得到同樣的決定。

- **邊緣**來自 `current & ~prevButtons`，`prevButtons` 逐角色存在 `SimWorld` 裡。Phaser 的 `JustDown()` 會**消耗**旗標且每 tick 只能讀一次，對任何重播都是致命的。
- **140 毫秒的蹲下緩衝**是 `downBufferedUntilTick`。它存在是為了讓以下結尾的指令在幾 tick 後仍讀作蹲下；它**不再**仲裁特殊技與大招 — 見下。
- **特殊鍵單按就是蓄力。** 前面沒有指令時按下會進入 `H_CHARGING` 並開始數 `chargeTicks`；放開時依 0 / 24 / 54 tick 打出 `chargeSpecials.ts` 的第 1、2 或 3 段。等級是從計數器**導出**而不是另外存，所以只有一個數字要快照。蓄力永遠不會自己放 — 計數器在第 3 段飽和而不是無限累加，這同時讓死不放手的角色不會永遠改變 checksum。蓄力期間禁止走、跳、攻擊**與防禦**，所以任何到達的攻擊都會打中；取消不需要寫任何程式，因為 `H_CHARGING` 是維持蓄力的唯一狀態，而受擊會用 `HITSTUN` 取代它。
- **大招只有一個輸入：它自己的按鍵。** 曾經有第二個，`下 + 特殊`，留自那顆按鍵存在之前的年代，而且它需要一條優先權規則才勉強能用：每個四分之一圓指令都會在按鍵之前兩三 tick 經過一個下，遠在蹲下緩衝之內，所以滿條時打 236 會放出大招而不是火球。那條規則在指令測試都跑在空條上時沒被發現是 bug — 空條時大招本來就會落回指令。**把那個輸入拿掉，那條規則也一起消失了**：蹲著的玩家拿得到自己的蓄力技，而特殊鍵無條件就是特殊鍵。
- **指令輸入**（236、214、623、雙擊）從 `commandHistory` 讀取，那是一個固定 30 tick 的原始輸入字環狀緩衝，逐角色存在 `SimWorld` 裡並計入 checksum（[src/sim/command.ts](../../src/sim/command.ts)）。upgraded build 在它的 controller 裡解析，緩衝裡裝的是按鍵的 `Set`；**世界之外的狀態，是對手收不到、rollback 也還原不了的狀態**，於是兩端會對「火球有沒有出來」有不同結論。這裡唯一的變動操作是記錄 — 每一次查詢都是純讀取，所以同一 tick 內可以重複問。
- **方向是相對面向的**（九宮格記法），所以一套撰寫好的指令在畫面兩側都成立。相對的方向互相抵消成中立，因為鍵盤在同時按下時兩邊都會回報。
- **`22` 是真正的雙擊** — 按下、放開、再按下 — 而不是 upgraded build 用的子序列比對。那種寫法光是**按著**下就會成立，因此無法與蹲下區分；它還會吃掉慢慢滾出來的 236，因為那會經過兩格的下，而 `22` 先被檢查。
- **防禦不是按鍵。** 它由移動方向與對手位置推得（§5），所以只能在模擬期間解出。
- **取樣**發生在 [KeyboardSampler](../../src/render/KeyboardSampler.ts)，每 tick 一次，把每個 keydown 閂鎖到下次讀取為止。在 144 Hz 下一個 tick 橫跨好幾個瀏覽器按鍵事件，而一次在兩次取樣之間開始又結束的輕點會整個消失。
- **一格輸入一旦為某 tick 送出，就是最終的。** 對一個已經傳送過的 tick 重新取樣會讓兩端分歧，因為對手留著它收到的第一個值。見 §11。

---

## 3. 角色狀態機

狀態（[FighterState.ts](../../src/fighters/FighterState.ts)）：`IDLE`、`WALK`、`CROUCH`、`JUMP`、`BLOCK`、`BLOCKSTUN`、`HITSTUN`、`LIGHT_ATTACK`、`HEAVY_ATTACK`、`SPECIAL`、`ULTIMATE`、`KO`、`VICTORY`，以及蓄力與 meme 招的狀態。

判定式（[src/sim/fighter.ts](../../src/sim/fighter.ts)）：

- `isAirborne` ⟺ `y < GROUND_Y - 1`。那一像素的容差防止角色在落地那一格在「站地／空中」之間閃爍。
- `isAttacking` ⟺ 狀態 ∈ {LIGHT_ATTACK, HEAVY_ATTACK, SPECIAL, ULTIMATE}
- `attackActive` ⟺ `startupTicks ≤ elapsedTicks < startupTicks + activeTicks`

### 每 tick 的順序（`stepFighter`）

**順序本身承重**：面向在防禦判定**之前**更新，所以「轉身」與「防禦」在同一 tick 解出。

1. **面向對手**：若非 KO，`facing = opponent.x >= x ? 1 : -1`
2. `away = opponent.x > x ? -1 : 1`
3. `guardHeld = inputEnabled && move === away && !crouch`
4. **恰好一個分支**：
   - **攻擊進行中** → 推進 `elapsedTicks`，在越過 startup 的那格設 `activeJustStarted`，套用攻擊位移（§6）；當 `elapsed ≥ startup + active + recovery × CONTROL_RECOVERY_MULTIPLIER` 且狀態非 KO 時清除，空中落到 `JUMP` 否則 `IDLE`
   - **HITSTUN / BLOCKSTUN** → 遞減；歸零後落到 `JUMP` 或 `IDLE`
   - **KO / VICTORY** → 凍結
   - **`inputEnabled`** → `processIntent`
   - **其他** → `vx = 0`；若站地且非 `CROUCH`，強制 `IDLE`
5. 套用物理（§4）

在回合開場期間按住的按鍵，會在開打第一格登記成一次**全新按下**。這重現了原版的行為：場景在 fight 階段之外根本不輪詢控制器。

### `processIntent` 的優先序

**空中** — 兩個選項，然後返回：
1. `lightPressed` → 空中輕擊；否則 `heavyPressed` → 空中重擊
2. 若沒有攻擊開始：`vx = move × speed × 0.75`，狀態 `JUMP`

**站地**，先命中者勝：
1. **防禦**：`move === away && !crouch && |opponent.x − x| < 340` → `BLOCK`，`vx = 0`
2. **大招**：`ultimatePressed` 且 `energy ≥ 100` 且 `canUseSpecial` → 花光整條。**能量不足時什麼都不做。** 沒有落回特殊技的後備：按住這顆鍵正是充能的方式，有後備就代表「伸手去蓄力」變成「丟了一顆火球」。
3. `specialPressed && canUseSpecial` → 特殊技
4. `lightPressed` → 輕擊　5. `heavyPressed` → 重擊
6. `jumpPressed` → `vy = JUMP_VELOCITY`，`JUMP`
7. `crouch` → `vx = 0`，`CROUCH`
8. `move ≠ 0` → `vx = move × SPEED_BY_STAT[speedStat]`，`WALK`
9. 否則 → `vx = 0`，`IDLE`

`canUseSpecial(tick)` = 冷卻結束、非 KO、非攻擊中、狀態 ∉ {HITSTUN, BLOCKSTUN}。

---

## 4. 物理（`stepPhysics`）

```
if (isAirborne || vy < 0):
    vy += GRAVITY * DT
    y  += vy * DT
    x  += vx * DT
    if (y >= GROUND_Y): y = GROUND_Y; vy = 0; if (state === JUMP) state = IDLE
else if (kind ∉ {dash, slide}):
    x += vx * DT

if (state ∈ {HITSTUN, BLOCKSTUN, KO}): vx *= STUN_FRICTION_PER_TICK

x = clamp(x, ARENA_MIN_X, ARENA_MAX_X)
```

- `vy < 0` 那一項是讓跳躍的第一格能離地的原因 — 那時 `y` 還沒移動到足以讓 `isAirborne` 成立。
- 衝刺與滑步靠攻擊位移自己驅動，所以對它們跳過 `vx` — 否則會用兩倍速移動。

### 推開（[src/sim/world.ts](../../src/sim/world.ts)）

在兩邊都更新完後執行，任一方在空中就整個跳過：

```
dx = p2.x - p1.x
if (|dx| >= 86 || |dx| < 0.01) return
overlap = 86 - |dx| ;  dir = dx >= 0 ? 1 : -1
p1.x = clamp(p1.x - dir * overlap * 0.5)
p2.x = clamp(p2.x + dir * overlap * 0.5)
```

`|dx| < 0.01` 那道保護代表**完全重疊的兩人不會被分開** — 因為沒有方向可以分開他們。

---

## 5. 防禦

`canBlockImpact`（[src/sim/combat.ts](../../src/sim/combat.ts)）是對**命中當下的防禦方**求值，不是對輸入被讀取時：

```
狀態 ∈ {BLOCK, BLOCKSTUN}  →  true
否則：guardHeld && !isAirborne && !isAttacking
      && 狀態 ∉ {HITSTUN, KO, VICTORY}
```

**`guardHeld` 沒有距離條件；只有 BLOCK 這個「站架」有。** 一個對著遠方對手往後推的角色，`guardHeld === true` 而狀態仍是 `IDLE`／`WALK` — 所以從畫面外飛來的彈丸**仍然擋得住**。這是從原版保留下來的。

擋下時：傷害縮成 `chipRatio`、擊退縮到 24%、沒有垂直擊退、進入 `BLOCKSTUN` 共 `blockstunTicks`。

---

## 6. 攻擊

`AttackSpec`（[AttackSpec.ts](../../src/combat/AttackSpec.ts)）**以 tick 撰寫**。[attackSpecs.ts](../../src/sim/attackSpecs.ts) 已經不做任何轉換；它在模組載入時仍做的事，是把過去散落在戰鬥程式各處的 `?? 1500` / `?? 2800` / `?? 900` 後備值一次解析掉 — 這就是為什麼每個 `TickSpec` 欄位都是必填，而對應的 `AttackSpec` 欄位是選填。

在 upgraded build 併入之前它是以毫秒撰寫的。**一個量有兩種單位，代表設計師打進去的數字永遠不是遊戲跑的數字** — `startupMs: 90` 變成 5 tick 也就是 83.3 毫秒，而你在那個 90 裡打不出任何能表達 5.5 的東西 — 而且每次修改都重新掀開「有沒有哪個窗口捨入成零、於是安靜地不再命中」這個問題。現在的值是把當年的捨入做一次然後留住，所以那次改動只動單位：golden replay 在它前後位元完全相同。

共用普通招，以 tick 計：

| | startup | active | recovery | 傷害 | hitstun | blockstun | kbX | kbY | 射程 |
|---|---|---|---|---|---|---|---|---|---|
| `LIGHT_ATTACK` | 5 | 5 | 10 | 5 | 11 | 5 | 150 | −40 | 78 |
| `HEAVY_ATTACK` | 11 | 7 | 18 | 9 | 18 | 9 | 255 | −110 | 104 |

逐角色的特殊技與大招在 [fighterData.ts](../../src/fighters/fighterData.ts)，由 [fighterData.test.ts](../../src/fighters/__tests__/fighterData.test.ts) 檢查形狀。

**攻擊位移**（`attackActive` 期間）：`dash` → `x += facing × 590 × DT`；`slide` → `× 670`；共用重擊 → `× 105`。其餘都不移動。

**特殊技冷卻在起手時就上，不是命中時**：
`nextSpecialTick = tick + cooldownTicks × CONTROL_COOLDOWN_MULTIPLIER(controlStat)`

### 判定框

Hurtbox：
```
crouching = 狀態 === CROUCH || guardCrouching || attack?.crouching
scale     = installTicks > 0 ? 2 : 1
height    = (crouching ? 194 × 0.66 : 194) × scale
width     = 104 × scale
rect(x - width / 2, y - height, width, height)
```

**變身讓身體加倍，判定框跟著身體。** 四個變身大招讓主人在 480 tick 內實際變成兩倍大，從中心向上向外長，所以腳留在地上。**這是變身付出的代價，不是美術的副作用**：打得更痛，也更好被打中。它是乘法而不是捨入 — `194 × 0.66` 本來就不是整數，兩端以相同順序求值相同的 IEEE-754 運算，而為了好看加上 `Math.round` 會改變判定框，並且需要重錄所有 golden replay 才能宣告這件事。

近身 hitbox：
```
reach   = spec.reach × RANGE_MULTIPLIER(rangeStat)
height  = 蹲下攻擊 ? 70 : 100
centerY = y - (蹲下 ? 58 : 空中 ? 100 : 108)
originX = facing > 0 ? x + 34 : x - 34 - reach
```

所有碰撞都是 AABB。**邊緣相接不算接觸。**

**蹲下不是迴避。** 站立近身框大約在腳上 58..158，而蹲下的 hurtbox 仍達 128，兩者重疊。蹲下只是把目標縮小。跳躍才真的閃得過。

---

## 7. 命中結算（`resolveHit`）

```
if (defender.isKO) return null
blocked   = canBlockImpact(defender)
full      = spec.damage × ATTACK_MULTIPLIER(attacker.attackStat)
                        × HP_STAT_MITIGATION(defender.hpStat)
damage    = blocked ? full × spec.chipRatio : full
```

接著 `receiveImpact`：

```
hp = clamp(hp - damage, 0, 100)
vx = attackerFacing × knockbackX × (blocked ? 0.24 : 1)
if (!blocked) vy = knockbackY

if (hp <= 0):                       // KO 蓋過一切
    state = KO ; attack = null ; stateRemainingTicks = 0
    vx = attackerFacing × max(420, knockbackX × 1.55)
    vy = min(-260, knockbackY × 1.5)
    return

if (blocked): state = BLOCKSTUN ; stateRemainingTicks = blockstunTicks
else:         state = HITSTUN
    hitstun = spec.hitstunTicks
    if (spec.kind === 'aura'):                       // 遞減的暈眩鎖
        if (tick < stunLockoutUntilTick) hitstun = min(11 ticks, hitstun)
        else stunLockoutUntilTick = tick + spec.stunLockoutTicks
attack = null                       // 任何命中都取消防禦方自己的攻擊
```

aura 的鎖定會**壓低**重複命中，且**不延長窗口**。這就是讓那招無法迴圈成無限暈眩的機制。

能量，夾限在 0..100：

| | 攻方獲得 | 守方獲得 |
|---|---|---|
| 乾淨命中 | `energyOnHit` | `energyOnReceive` |
| 被擋下、`chipRatio > 0` | `ceil(energyOnHit × 0.35)` | `ceil(energyOnReceive × 0.35)` |
| 被擋下、`chipRatio === 0` | 0 | 0 |

**Hit-stop 凍結整個模擬**：擋下 2 tick、輕擊 3、重擊 5、特殊 6、大招 9，外加大招首次演出時一次性的 7。

重複命中的防止是每個攻擊實例、彈丸、領域各自的兩位元 `hitMask`。**物件識別在序列化後不會存活。**

### 攻擊種類

`melee`、`dash`、`slide`、`aura` 在**每個 active tick** 都測近身框。其餘所有種類只在 `activeJustStarted` 觸發**一次**：

| kind | 行為 |
|---|---|
| `sonic`、`water`、`salad` | 生成彈丸（§8） |
| `beam` | 即時矩形：`width = reach`，前方 45 px，位於 `y - 122`，高 60 px |
| `zone`、`ultimate-salad` | 生成延遲的地面領域（§8） |
| `ultimate-ok`、`ultimate-sonic` | 寬框：寬 `reach`，自 `y = 120` 至 `GROUND_Y - 70` |
| `ultimate-water`、`-social`、`-freeze`、`-alien`、`-magic` | **無條件命中**，沒有幾何 |

---

## 8. 彈丸與領域

**彈丸**：生成在 `(owner.x + facing × 70, owner.y - 118)`，`vx = facing × projectileSpeed`，尺寸 water `118×34`、salad `76×54`、其餘 `90×46`。每 tick：老化、移動、再與目標 hurtbox 做 AABB — 已命中或目標已 KO 就跳過。命中、逾期，或 `x` 超出畫面 100 px 時消失。

**領域**相對於**防禦方**放置，是唯一生成位置取決於對手的攻擊：

| | `zone` | `ultimate-salad` |
|---|---|---|
| x | `clamp(defender.x + defender.vx × 0.15, 120, 1160)` | `clamp(defender.x, 130, 1150)` |
| 預告 | `telegraph ?? 27t` | 撰寫值 `30t` |
| 生效 | `spec.activeTicks` | **13 tick，寫死** |
| 命中半徑 | `< 100` | `< 150` |

預告結束後，目標在半徑內**且** `hurtbox.bottom > GROUND_Y - 250` 才會被打中 — 跳起來就閃過了。

---

## 9. 回合與比賽流程（[src/sim/world.ts](../../src/sim/world.ts)）

階段：`intro` → `fight` → `ending`，由世界裡的 `phase` 與 `phaseTicks` 驅動。這些原本是 `scene.time.delayedCall` 定時器，它們會在兩端漂移，而且無法重播。

- **Intro**：tick 0 顯示「ROUND n」，37 顯示「CAT FIGHT!」，67 交出控制權。
- **Fight**：控制器產生輸入、兩個角色更新、執行推開、結算戰鬥、`roundTicksRemaining` 遞減。
- **Hit-stop**：為正時該 tick 整個模擬被跳過，只有計數器動。它住在世界裡而不是場景裡，所以會被快照。
- **回合結束**：
  - **KO** — 兩邊都倒是 `0`，否則是還站著的那個。輸家的 KO 狀態來自 `receiveImpact`；`endRound` **刻意不重新套用**。
  - **時間到** — `|p1.hp − p2.hp| < 0.01` 算平手，否則血多者勝。時間到時輸家會被**擺成** KO 的姿勢，因為實際上沒有人倒下。
  - 141 tick 之後：兩勝結束比賽，否則進入下一回合。

---

## 10. 決定性規則

全部已解決，且全部由 [purity.test.ts](../../src/sim/__tests__/purity.test.ts) 強制 — 它讓建置失敗，而不是等兩個玩家發現彼此對不上。

| 規則 | 為什麼 |
|---|---|
| 固定 60 Hz 步長，`DT` 為常數 | 量出來的影格間隔會讓 60 Hz 與 144 Hz 的客戶端算出不同位置 |
| 只用 tick 計數，絕不用牆上時鐘 | 時鐘在機器之間漂移，而且無法倒帶 |
| 不用 `Math.pow`/`sin`/`cos`/`exp` 或 `**` | 各引擎之間不保證位元相同 |
| 不 import Phaser、不碰 DOM | 模擬必須能在伺服器或測試裡無頭執行 |
| 實體之間不用物件參考 | 用 `hitMask` 位元與 `ownerIndex`，讓狀態能通過序列化 |
| 不用 `Math.random` | 用 `rng.ts`，由主機給種子，狀態放在 `SimWorld` 內 |
| 不用模組層級的可變狀態 | 用 `world.nextEntityId`，兩個世界才不會互相干擾 |

**只允許 `+ - * /` 與 `Math.min/max/abs/floor/ceil/round/trunc/sign/sqrt`** — IEEE 754 要求精確捨入的那些運算。

[VFXManager](../../src/systems/VFXManager.ts)、[StageRenderer](../../src/stages/StageRenderer.ts) 與 [AudioManager](../../src/systems/AudioManager.ts) 裡的 `Math.random` **沒問題而且必須留著**。它們純屬表現且永遠不回饋進狀態 — 而那正是這個切分存在的全部理由。

---

## 11. 網路層依賴的規則

這些不是模擬規則，但破壞它們就破壞了模擬的承諾。每一條都來自一個**只在兩台真實機器之間才出現**的 bug。

- **兩端必須使用相同的輸入延遲。** 它決定開場有多少 tick 跑在預填的中立輸入上。值不同會讓雙方各自等待一格對方永遠不會送出的輸入 — 開打幾 tick 後永久卡住，與斷線無法區分。它在大廳議定，不是各機器自算。
- **兩端必須使用相同的傳輸。** 一邊用資料通道送、另一邊在 socket 上聽，症狀一模一樣。
- **已送出的輸入格是最終的。** 對手為某個 tick 保留它收到的第一個值，所以事後改變主意代表兩邊用不同輸入模擬同一 tick。這在正常遊玩中就到得了：一個卡住的客戶端會被持續詢問按鍵，而一個正在按鍵的玩家每次都給出不同答案。
- **冗餘窗口必須大於輸入延遲，並留餘裕。** 一個客戶端可以合法地落後整整一個延遲，所以剛好等寬的窗口已經滑過它還需要的那些格 — 而通道是不可靠的，於是一次丟包就變成永久遺失。
- **卡頓不是要補回來的債。** 兩端受同一批輸入閘住，所以誰都不會領先；把等待的時間累積下去只會讓比賽永久落後真實時間。

---

延伸閱讀：[戰鬥系統](combat-system.md)、[Lockstep](../networking/lockstep.md)、[架構總覽](../architecture.md)。
