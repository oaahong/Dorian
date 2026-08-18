# 架構總覽

整個專案只有一條規則：

> **`src/sim` 永遠不 import Phaser，`src/render` 永遠不寫入模擬狀態。**

其他所有設計決策都是這條規則的後果。這份文件解釋它為什麼存在，以及它換來了什麼。

## 為什麼是這條

因為連線對戰用的是 **lockstep**：兩台機器各自跑自己的模擬，網路上只傳按鍵狀態，然後兩邊必須算出**位元完全相同**的結果。

要做到這件事，模擬不能碰任何在兩台機器上會不一樣的東西：

| 不能碰 | 為什麼 |
|---|---|
| 牆上時鐘（`Date.now()`、`performance.now()`） | 兩台機器的時間不同，而且不能倒帶 |
| 影格間隔（delta time） | 一台 144Hz 一台 30Hz，算出來的物理就不同 |
| `Math.random()` | 第一個 CPU 決策就會分歧 |
| 渲染函式庫 | Phaser 的物件帶著顯示狀態，無法快照 |

所以模擬只吃「上一個狀態 + 兩邊的按鍵」，吐出「下一個狀態 + 一串事件」。它是一個純函式。

## 換來了什麼

這條規則不只是為了連線。它順帶解決了四件事：

**1. 大部分遊戲可以無瀏覽器測試。** `src/sim` 在 Node 裡跑得起來，所以物理、判定、回合流程都用一般單元測試覆蓋，不需要開瀏覽器。929 個單元測試裡絕大多數屬於這一層。

**2. 整場比賽可以被快照。** `SimWorld` 是純資料，能被 structured clone。這就是 golden replay 的基礎 — 把一整場比賽壓成一串 checksum，任何行為改動都會讓那串數字動。

**3. 表現層可以隨便亂來。** 音效、粒子、螢幕震動可以讀牆上時鐘、可以用 `Math.random()`、可以吃 delta time — 因為它們在線的另一側，怎麼樣都影響不到對手算出什麼。

**4. 伺服器有一天可以自己跑模擬。** 這是「客戶端可作弊」那個限制的逃生口，見 [伺服器職責](server/responsibilities.md)。

## 這條規則怎麼被強制

不是靠自律。[`src/sim/__tests__/purity.test.ts`](../src/sim/__tests__/purity.test.ts) 逐檔掃描 `src/sim` 底下的原始碼，任何一項違反就紅：

- 不得 `from 'phaser'`
- 不得 import `render/`、`scenes/`、`ui/`、`stages/`
- 不得出現 `Date.now`、`new Date`、`performance.now`
- 不得出現 `Math.random`
- 不得出現超越函數

在有 ESLint 的專案裡這些會是 lint 規則。這個 repo 沒有，而為了兩條規則拉進整套工具鏈並不划算 — 測試在同一個時機抓到同樣的錯，還多一個好處：理由就寫在斷言旁邊。

**違反這條規則的症狀是看不見的。** 在你自己機器上遊戲跑得好好的，只有在兩個玩家連線時才會表現成「兩個畫面安靜地各說各話」。這就是為什麼防線設在編譯前而不是靠測試玩。

## 資料怎麼流

```
鍵盤
 └─> KeyboardSampler          每 tick 一個 16-bit 按鍵字
      └─> Session             「這個 tick 可以跑了嗎？」
           │                   離線：永遠可以
           │                   連線：等對手那一格到齊
           └─> stepWorld(world, [p1, p2])
                ├─> SimWorld   （下一個狀態，純資料）
                └─> SimEvent[] （這個 tick 發生了什麼）
                     └─> BattleView
                          ├─> FighterView / CombatView / UltimateStage
                          ├─> VFXManager / AudioManager
                          └─> BattleHUD
```

箭頭全部單向。`BattleView` 收到的是**唯讀**的世界和一串已經發生的事實，它唯一能做的是把它們畫出來。

## 為什麼 `Session` 是整個連線功能的接縫

離線和連線的差別，被壓縮成一個介面的一個問題：**這個 tick 的輸入齊了嗎？**

- [`LocalSession`](../src/net/LocalSession.ts)：齊了，永遠。
- [`LockstepSession`](../src/net/LockstepSession.ts)：要等對手排定的那一格到達。

`BattleScene` 兩種模式走同一條呼叫路徑。**切換到連線對戰是換一個 session，不是改一套遊戲邏輯** — 這就是為什麼連線功能沒有在戰鬥程式碼裡留下任何痕跡。

詳見 [Lockstep](networking/lockstep.md)。

## 一個 repo，兩個 build，一份共用核心

`npm run build` 用 Vite 把客戶端打包進 `dist/`；`npm run build:server` 用 `tsconfig.server.json` 把伺服器編進 `build/`。

伺服器是**另一個 build 而不是另一個 codebase**，因為兩端必須對某些事情有共識，而那些事情沒有一方能單獨決定：

| 共用的東西 | 如果各寫一份會怎樣 |
|---|---|
| `src/net/protocol` | 線路格式單邊漂移 |
| `src/net/roomCode` | 一邊接受的房號另一邊拒絕 |
| `src/sim/rng` | 抽出來的種子與場地不一致 |

而 `protocol` 又反過來讀 `src/sim/input` 和 `src/sim/types`。任何一份複製貼上，結果都是 lockstep 在別的地方報 desync。

這也帶出兩個看起來很怪、知道原因後就合理的決定 — 見 [建置與部署](server/build-and-deploy.md)。

## 目錄與這條規則的關係

| 目錄 | 在線的哪一側 | 能不能碰 Phaser |
|---|---|---|
| `src/sim` | 模擬 | **不行**（測試強制） |
| `src/fighters`、`src/combat` | 模擬（純資料） | 不行 |
| `src/net` | 兩者之間 | 不行（三個檔例外，見下） |
| `src/render`、`src/scenes`、`src/ui`、`src/stages`、`src/systems` | 表現 | 可以 |
| `server/` | 伺服器 | 不行 |

`src/net` 裡有三個檔案會碰 `location` 和 `RTCPeerConnection`（`OnlineClient`、`onlineMatch`、`WebRtcTransport`），所以它們被排除在伺服器 build 之外 — 伺服器不載入它們，而把它們包進去會把整個 DOM 型別庫拖進 Node build。

下一步：[專案結構](project-structure.md)。
