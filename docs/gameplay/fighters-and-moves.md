# 角色與招式

12 個角色的資料長什麼樣、招式怎麼被叫出來、frame data 從哪來。引擎本身在 [戰鬥系統](combat-system.md)。

主要程式：[`fighters/fighterData.ts`](../../src/fighters/fighterData.ts)、[`fighters/chargeSpecials.ts`](../../src/fighters/chargeSpecials.ts)、[`sim/command.ts`](../../src/sim/command.ts)。

## 名冊

| # | id | 名稱 | 236 | 大招 |
|---|---|---|---|---|
| 01 | `alien` | Alien Meow／訊號壞掉喵 | 斷訊掃描波 | 逼逼逼動感光波 |
| 02 | `doge` | Doge | 側眼施壓 | 超級賽狗 |
| 03 | `ya` | YA鼠 | 尷尬打招呼 | 哈ㄗ咖西 |
| 04 | `tempura` | oh fucking 天婦羅尬哩涼 | 企鵝縱隊 | oh fucking 天婦羅尬哩涼！ |
| 05 | `goblin` | 哥布林也想談戀愛 | 鎖喉告白 | 長老您保重 |
| 06 | `salad` | 沙拉貓貓 | 我不想吃這個 | 菜就多練 |
| 07 | `wizard` | 魔法胖橘貓 | JPEG魔法陣 | 喵蘇魯的召喚！ |
| 08 | `blade` | 我的刀盾 | 鈍刀亂磨 | 汪爆氣流斬 |
| 09 | `pink` | 粉紅星星 | 尖叫嘴震 | 派甜心假面...露出 |
| 10 | `sauce` | 蘸醬胡渣狗 | 蘸醬討飯 | 胡渣男！ |
| 11 | `scared` | 驚嚇小貓 | 尖叫震波 | 嗷嗷嗷嗷嗷！！ |
| 12 | `ok` | OK喵老大 | OK衝刺 | 大哥你是了解我的 |

## 一個角色由什麼組成

```ts
{
  id, number, name, shortName,
  hpStat, attackStat, speedStat, rangeStat, controlStat,   // 1..5
  damageTakenScalar,                                        // 逐角色微調
  specials: { quarterForward, quarterBack, dragonPunch?, functionMove },
  ultimate,
  palette,
}
```

**四項屬性是 1..5 的粗調鈕**，各自對應一條乘數曲線而不是查表：

| 屬性 | 影響 | 公式 |
|---|---|---|
| `attackStat` | 傷害 | `0.85 + stat × 0.07` |
| `rangeStat` | 招式射程 | `0.88 + stat × 0.055` |
| `controlStat` | 收招與冷卻 | `1.05 - stat × 0.025` |
| `speedStat` | 移動與衝刺 | 查 `SPEED_BY_STAT` |

`damageTakenScalar` 和 `hpStat` 做的是不同的事：一個角色可以在選角畫面上看起來很耐打，同時是那個被長串連段打崩的。

**所有角色顯示的血量都是 100。** `hpStat` 影響的是身分與平衡，不是可見的血量上限。

## 招式怎麼被叫出來

每個角色有三或四個依「呼叫它的指令」命名的特殊技。**依指令命名而不是放進陣列**，因為指令是招式身分的一部分 — 每個角色的 `quarterForward` 都是它的「火球位」。

| 輸入 | 招式 |
|---|---|
| `236` + 特殊鍵 | `quarterForward` |
| `214` + 特殊鍵 | `quarterBack` |
| `623` + 特殊鍵 | `dragonPunch`（只有 `scared` 有） |
| 雙擊下 + 特殊鍵 | `functionMove` |
| **特殊鍵單按** | 蓄力特殊技（見下） |
| 大招鍵，MEME = 100 | `ultimate` |

指令在**模擬內**判讀（[`sim/command.ts`](../../src/sim/command.ts)），從一個 30 tick 的原始輸入環狀緩衝比對。upgraded build 是在 controller 裡用 `Set` 解析的，那種寫法無法通過 lockstep — 兩端必須對「打出了什麼」有完全一致的結論。

指令會依面向鏡射：對手在左邊時，`236` 的方向鍵也跟著翻。

## 蓄力特殊技

按住特殊鍵、前面沒有指令，角色就進入 `H_CHARGING`；放開時依按住長度打出三段之一。

| 等級 | 按住 tick | 秒 |
|---|---|---|
| Lv1 | 0–23 | < 0.40 |
| Lv2 | 24–53 | 0.40–0.90 |
| Lv3 | 54+ | ≥ 0.90 |

三條規則值得記住：

1. **滿蓄不會自己放。** 計數器在 Lv3 飽和而不是繼續累加 — 一方面讓「賭滿蓄」變成對手看得見也懲罰得到的決定，另一方面讓死不放手的角色不會永遠改變 checksum。
2. **蓄力期間不能走、跳、攻擊、投、防禦。** 這是它昂貴的原因。被打中會取消，而且不需要為此寫程式 — 命中會把角色推進 `HITSTUN`，而 `H_CHARGING` 是維持蓄力的唯一狀態。
3. **完全沒有冷卻。** 收招一結束就能再蓄。這是交付說明反覆強調的一條，也是為什麼舊的 `S + H` 大招輸入被移除 — 它會搶走蹲下後 8 tick 內的任何特殊鍵。

三段各有自己的美術（[`render/effectCells.ts`](../../src/render/effectCells.ts)），所以對手看得出你蓄了多久。

## frame data 從哪來

**所有時間值原封不動來自 upgraded build**：startup、active、recovery、hitstun、blockstun、護甲與無敵窗口、多段傷害列表與各段間隔，都是那邊調出來的數字。

**擊退在這個模擬的單位裡重新撰寫**，但保留相對權重。最清楚的例子是驚嚇衝撞三段的 `120 < 190 < 280`，那個順序關係活了下來。

`AttackSpec` 以 tick 撰寫，這正是讓 frame data「能當資料搬運」而不是「必須翻譯」的原因。

## AttackKind 是行為分類

`AttackKind` 分的是**模擬會對它做什麼**，不是它畫起來像什麼。兩招共用一個 kind，代表模擬處理它們的方式相同 — 所以 `burst`、`antiAir`、`commandThrow` 各自存在，而十二個不同的火球共用 `projectile`。

大致分四群：

| 群 | kind |
|---|---|
| 手臂長度內揮出 | `melee` `strike` `multiStrike` `antiAir` `burst` `counter` `commandThrow` |
| 自己往前衝 | `dash` `slide` `dashStrike` |
| 有東西離開角色 | `sonic` `water` `salad` `projectile` `summon` |
| 放置或發射的幾何 | `aura` `zone` `beam` … |

要加真正的新行為時，加**一個**可重用的 `AttackKind` 和 `world.ts` 裡**一個** handler — 不要複製角色引擎。

## 兩個刻意的簡化

upgraded build 的兩個防禦招在這裡用既有機制重新詮釋：

- `doge-sideeye`：改成**護甲**，而不是會反傷的架招
- `ok-fear`：改成有實際判定框的 `aura`，而不是讀取對手狀態的條件式暈眩

兩者都是「一個機制取代兩個」，並且都在撰寫處註明。

另外兩個 — `status:'counterStance'` 與 `status:'goblinInstall'` — 在 upgraded build 裡本來就是死的：招式上有寫，但沒有任何程式讀它。那裡本來就沒有行為可搬。

延伸閱讀：[大招與變身](ultimates-and-installs.md)、[模擬核心規格](sim-spec.md)。
