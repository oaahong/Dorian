# 文件

這裡是細節。[根目錄的 README](../README.md) 是入口 — 怎麼安裝、怎麼跑、怎麼玩、大方向為什麼長這樣；那些不在這裡重複。

## 三條閱讀路徑

**第一次接觸這個專案**
[架構總覽](architecture.md) → [專案結構](project-structure.md) → [場景流程](client/scene-flow.md)

一小時內會知道：為什麼 `src/sim` 不准 import Phaser，程式碼放在哪，以及從按下空白鍵到打出一拳中間經過哪些檔案。

**要改玩法或加角色**
[戰鬥系統](gameplay/combat-system.md) → [角色與招式](gameplay/fighters-and-moves.md) → [模擬核心規格](gameplay/sim-spec.md) → [測試策略](testing.md)

規格那份是權威：任何跟它衝突的敘述以它為準，而它跟程式衝突時，是它要改。

**要修連線問題**
[Lockstep](networking/lockstep.md) → [連線建立與除錯](networking/connection-and-debugging.md) → [伺服器職責](server/responsibilities.md)

先讀 lockstep 那份的「兩個已知代價」一節。很多回報的「lag」其實是設計本身，而不是故障。

## 全部文件

| | |
|---|---|
| [architecture.md](architecture.md) | 一條規則與它的所有後果 |
| [project-structure.md](project-structure.md) | 逐資料夾、逐檔案 |
| **遊戲機制** | |
| [gameplay/combat-system.md](gameplay/combat-system.md) | 狀態機、物理、判定、防禦、連段 |
| [gameplay/fighters-and-moves.md](gameplay/fighters-and-moves.md) | 12 角色、frame data、指令輸入 |
| [gameplay/ultimates-and-installs.md](gameplay/ultimates-and-installs.md) | 大招時間軸、演出、變身、召喚物 |
| [gameplay/cpu-ai.md](gameplay/cpu-ai.md) | CPU 決策與難度 |
| [gameplay/sim-spec.md](gameplay/sim-spec.md) | 模擬核心的權威規格 |
| **前端** | |
| [client/scene-flow.md](client/scene-flow.md) | Phaser 場景圖與轉場 |
| [client/rendering.md](client/rendering.md) | render 層如何讀 SimWorld |
| [client/art-pipeline.md](client/art-pipeline.md) | 兩條資產管線、836 張圖 |
| [client/audio-and-hud.md](client/audio-and-hud.md) | 音效合成、HUD、特效 |
| **後端** | |
| [server/responsibilities.md](server/responsibilities.md) | 它做什麼，以及不做什麼 |
| [server/rooms-and-state.md](server/rooms-and-state.md) | 房間登錄、TTL、為什麼沒有資料庫 |
| [server/build-and-deploy.md](server/build-and-deploy.md) | 雙 build、容器、部署平台 |
| **網路連線** | |
| [networking/lockstep.md](networking/lockstep.md) | 輸入延遲、校驗和、desync |
| [networking/transport-and-protocol.md](networking/transport-and-protocol.md) | 傳輸介面與線路格式 |
| [networking/connection-and-debugging.md](networking/connection-and-debugging.md) | 房號流程、NAT、除錯面板 |
| **其他** | |
| [testing.md](testing.md) | 五層測試策略 |
| [workflow.md](workflow.md) | 開發、加角色、發版、CI |

## 一份不是文件的檔案

[upgraded-build.md](upgraded-build.md) 是 upgraded build 交付時所附說明的**逐字副本**。

它描述的是另一棵樹 — 一個 Phaser 3 的物件導向版本，類別名稱和檔案路徑在這個 repo 裡多半不存在。留著是因為它是**紀錄**：它是這次移植的規格來源，也是判斷「某個行為是刻意改的還是漏掉的」時唯一的依據。

**不要改寫它。** 它寫錯的地方（有幾處把特效圖當角色圖用）在對應的實作檔案裡註明並用測試釘住，而不是在它身上修改。改它等於竄改交付紀錄。
