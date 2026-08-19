# 傳輸與協定

按鍵怎麼離開這台機器、怎麼抵達那台。

## `Transport`：四個方法

[`Transport.ts`](../../src/net/Transport.ts) 只有四個方法：送輸入、送校驗和、收輸入、收校驗和。

**這讓 `LockstepSession` 永遠看不到 socket、JSON 或重連。** 換傳輸方式是換一個實作，不是改 session。

兩個實作：

| | |
|---|---|
| `WebRtcTransport` | 點對點直連 |
| `OnlineClient` | 一個 socket 同時承載大廳流量與**中繼後備** |

**兩端必須使用相同的傳輸。** 一邊用資料通道送、另一邊在 socket 上聽，症狀跟輸入延遲不一致一模一樣：永久卡住。

## 為什麼要直連

兩個在同一個國家的玩家，直連大約相距 10–15 毫秒，但經由另一個國家的資料中心中繼是 60 毫秒。

而且那個差距會被**加倍**進輸入延遲，因為一格輸入要來回。所以直連不是微調，是手感的分水嶺。

穿透用公開 STUN。**行不通的時候，那條已經連著的中繼接手** — 所以沒有需要付費的 TURN 伺服器。大廳會顯示最後拿到的是哪一種。

## 一個 socket，兩種編碼

[`protocol.ts`](../../src/net/protocol.ts) 依**流量形狀**選編碼：

| 流量 | 編碼 | 為什麼 |
|---|---|---|
| 大廳 | JSON | 罕見、在網路檢視器裡人看得懂、形狀會隨功能改變 |
| 輸入與校驗和 | binary | 每秒 60 次、形狀固定、每個位元組都算數 |

### 大廳訊息

客戶端 → 伺服器：
`createRoom` `joinRoom` `selectCharacter` `ready` `signal` `ping` `leave`

伺服器 → 客戶端：
`roomState` `matchStart` `opponentLeft` `signal` `pong` `error`

錯誤碼：
`room-not-found` `room-full` `already-in-room` `not-in-room` `bad-message` `rate-limited`

`matchStart` 帶著兩端**必須一致**的東西：`seed`、`stage`、兩位角色、`inputDelay`。

### 二進位封包

輸入封包帶著一段連續的輸入格（上限 64 格），後面接一段**選用的尾段**：

```
[kind:u8=1][startTick:u32][count:u8][frames:u16 × count]
--- 尾段，長度只能是 0、5 或 13 ---
[extTag:u8]        0xA1 = 只有 ack；0xA2 = ack + 校驗和
[nextWanted:u32]   送方仍然需要對方補的最低 tick
[checksumTick:u32][checksumHash:u32]    僅 0xA2
```

`nextWanted` 就是 [Lockstep](lockstep.md) 的 ACK 窗口用的那個 ack。校驗和搭在這裡，省掉每秒一個獨立封包。

**為什麼是尾段，而不是一個新的 kind 值** — 中繼伺服器的 `handleBinary` 會先 `decodeBinary` 驗證、失敗就丟棄。新的 kind 值代表**舊伺服器會把新客戶端的每一個封包黑洞掉**，所有中繼對戰立刻全滅；而客戶端可以合法地比伺服器新（見 `OnlineClient.url` 的 CDN 註解）。

尾段則是兩邊都優雅降級：長度檢查是最小值而非精確值，所以舊解碼器忽略尾段、舊中繼原樣轉發；而收不到 `nextWanted` 的客戶端會自動退回固定窗口。

尾段的**標記與長度都要對**才會被接受 — 只靠長度判斷的話，隨機的尾隨位元組會被當成 ack，而 ack 正是惡意對端最想廉價偽造的欄位。

大小上限：大廳訊息 16 KB、信令 12 KB — **用來限制一個對端能讓伺服器解析多少東西。**

## 共用的東西，以及為什麼必須共用

`protocol.ts` 與 `roomCode.ts` 由**客戶端與伺服器共用**，而 `protocol` 又反過來讀 `src/sim/input` 與 `src/sim/types`。

任何一份複製貼上，結果都是**線路格式單邊漂移**，而 lockstep 會在完全不相干的地方報 desync。

這也是伺服器是「另一個 build 而不是另一個 codebase」的理由 — 見 [建置與部署](../server/build-and-deploy.md)。

## 輸入承載

一格輸入是**一個 16-bit 的原始按鍵字**：

```
bit 0 左    bit 1 右    bit 2 上    bit 3 下
bit 4 輕擊  bit 5 重擊  bit 6 特殊  bit 7 投  bit 8 大招
```

**任何導出的東西都不上線。** 按鍵邊緣、是否防禦、打出了哪個指令，全部在模擬內重算 — 所以對同一批位元組重跑一次會得到同樣的決定。詳見 [模擬核心規格 §2](../gameplay/sim-spec.md#2-輸入)。

延伸閱讀：[Lockstep](lockstep.md)、[連線建立與除錯](connection-and-debugging.md)。
