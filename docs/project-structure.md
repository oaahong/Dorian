# 專案結構

逐資料夾、逐檔案。測試檔不個別列出 — 它們的策略在 [測試策略](testing.md)。

```
Dorian/
├─ src/          客戶端：模擬 + 表現
├─ server/       信令伺服器與房間登錄
├─ e2e/          Playwright：真實瀏覽器與真實連線對戰
├─ scripts/      資產管線（Python）與發版工具（Node）
├─ public/       靜態資產：836 張圖
├─ audit/        資產管線的產出紀錄與對照表
├─ asset_pipeline_backups/   技能圖管線的來源 zip（**輸入**，不是備份）
└─ docs/         這裡
```

> upgraded build 的原始交付內容曾經以 `project-working-upgraded/` 放在工作區裡。它已經被刪除 — 那份快照是 `upgrade-base` 分支上的一個 commit，留一份副本在樹裡等於留了第二份。它的說明文件仍以 [upgraded-build.md](upgraded-build.md) 逐字保存。

---

## `src/sim` — 遊戲本身

純資料與純函式。不 import Phaser，不讀時鐘，不用 `Math.random`。詳見 [模擬核心規格](gameplay/sim-spec.md)。

| 檔案 | 職責 |
|---|---|
| `world.ts` | `stepWorld(world, [p1, p2]) -> SimEvent[]`。整場比賽是一個可步進的狀態機：回合階段、計時、實體清單、大招時間軸、召喚物都在這裡推進 |
| `fighter.ts` | 單一角色的物理與狀態機。輸入解讀、移動、攻擊推進、蓄力、chord |
| `combat.ts` | 碰撞幾何與命中結算。hurtbox / hitbox、防禦高度、傷害、擊退 |
| `attackSpecs.ts` | 把 `AttackSpec` 的選填欄位在載入時一次解析完，讓熱路徑不必處理 `??` |
| `cpu.ts` | 有限狀態機 CPU。用 seeded 亂數，所以 1P 對戰可重播 |
| `command.ts` | 指令輸入判讀（236 / 214 / 623 / 雙擊下）。在模擬內解析，兩端才不會對「打出了什麼」有異議 |
| `input.ts` | 一個 tick 的原始按鍵，壓成 16-bit 字。這就是網路承載 |
| `rng.ts` | seeded xorshift32。整個狀態是一個 uint32，活在 `SimWorld` 裡 |
| `hash.ts` | FNV-1a。每 60 tick 對世界取雜湊，用來偵測 desync |
| `constants.ts` | 所有玩法數值的唯一真相，以 tick 為單位 |
| `types.ts` | 模擬狀態的型別。純資料，必須能被 structured clone |

## `src/fighters`、`src/combat` — 角色與招式資料

模擬層讀得到的純資料，但和引擎分開，因為它們是**內容**不是**機制**。

| 檔案 | 職責 |
|---|---|
| `fighterData.ts` | 12 個角色的完整定義：屬性、招式、frame data、配色 |
| `FighterConfig.ts` | 角色設定的型別。招式依「呼叫它的指令」命名，不用陣列 |
| `FighterState.ts` | 20 個角色狀態（IDLE、H_CHARGING、MEME_PARRY…） |
| `chargeSpecials.ts` | 蓄力特殊技，每人三段（24 / 54 tick 分界） |
| `ultimateTimelines.ts` | 大招**打到哪、什麼時候打** — hitbox 時間軸 |
| `ultimateVisuals.ts` | 大招**長什麼樣** — 美術拍點。與上一份共用 tick 時基 |
| `ultimateDefinitions.ts` | Cut-in 的背景、立繪、台詞、標題，以及**凍結長度** |
| `installPoses.ts` | 變身後的整套姿勢，以及刀盾的兩把掛載武器 |
| `summonArt.ts` | 召喚物的姿勢，由模擬狀態推導 |
| `skillCells.ts` | **產生檔** — 每隻角色有哪些技能圖格。勿手改 |
| `poseSheet.ts` | 姿勢名稱 → 圖號，以及技能圖的路徑與 key |
| `combat/AttackSpec.ts` | 一次攻擊「做什麼」的型別。`AttackKind` 是行為分類不是風味分類 |

## `src/net` — 連線

詳見 [傳輸與協定](networking/transport-and-protocol.md)。

| 檔案 | 職責 |
|---|---|
| `Session.ts` | 整個連線功能的接縫：「這個 tick 可以跑了嗎？」 |
| `LocalSession.ts` | 離線的答案：可以，永遠 |
| `LockstepSession.ts` | 輸入延遲、重送、校驗和比對 |
| `Transport.ts` | 四個方法。讓 session 永遠看不到 socket |
| `WebRtcTransport.ts` | 點對點直連 |
| `OnlineClient.ts` | 一個 socket 同時承載大廳訊息與中繼流量 |
| `protocol.ts` | 大廳走 JSON，遊戲走 binary。兩端共用 |
| `roomCode.ts` | 房號字母表與驗證，兩端共用 |
| `onlineMatch.ts` | 大廳交棒給戰鬥場景的暫存點 |

## `src/render` — 表現層

讀 `SimWorld`，擁有所有 Phaser 物件，**從不寫回模擬**。

| 檔案 | 職責 |
|---|---|
| `BattleView.ts` | 把 `SimEvent` 翻成聲音、火花與播報 |
| `FighterView.ts` | 一個角色的貼圖、姿勢、變身放大與武器掛點 |
| `CombatView.ts` | 彈丸、領域、光束、召喚物 |
| `UltimateStage.ts` | 播放大招的美術拍點 |
| `UltimateCutIn.ts` | 大招開場演出，跟著模擬的凍結倒數走 |
| `ultimateSchedule.ts` | **純函式**：這一影格該放哪些拍點 |
| `effectCells.ts` | **純函式**：蓄力三段各用哪張圖 |
| `fit.ts` | 把圖縮到指定高度，不管來源解析度 |
| `KeyboardSampler.ts` | 鍵盤 → 每 tick 一個按鍵字，帶閂鎖 |

## `src/scenes` — Phaser 場景

詳見 [場景流程](client/scene-flow.md)。

`BootScene` `TitleScene` `ModeSelectScene` `CharacterSelectScene` `OnlineLobbyScene` `PrepareMatchScene` `VsScene` `BattleScene` `ResultScene`

`BattleScene` 是唯一含有迴圈的：它取樣輸入、以固定步長推進 `stepWorld`、把結果交給 view。它**不含任何玩法邏輯**。

## `src/systems`、`src/ui`、`src/stages`、`src/utils`

| 檔案 | 職責 |
|---|---|
| `systems/AudioManager.ts` | 所有音效用 `AudioContext` 振盪器即時合成 — 沒有任何音檔 |
| `systems/GameState.ts` | 跨場景的比賽設定（模式、角色、難度） |
| `systems/VFXManager.ts` | 火花、震波、殘影、閃光、震動 |
| `ui/BattleHUD.ts` | 血條、MEME 條、計時、回合指示。每影格直接讀 `SimWorld` |
| `ui/HealthBar.ts`、`ui/MemeMeter.ts` | 兩個條的繪製 |
| `stages/StageRenderer.ts` | 場地背景 |
| `utils/constants.ts` | 顏色與字型，加上 `sim/constants` 的再匯出 |
| `types/global.d.ts` | `window.__MEME_CAT_GAME__` 的型別，給 e2e 用 |

> `src/input/` 是**空資料夾**，早期重構的殘留。可以刪。

## `server/` — 信令伺服器

三個原始檔。詳見 [伺服器職責](server/responsibilities.md)。

| 檔案 | 職責 |
|---|---|
| `rooms.ts` | 房間簿記，寫成對顯式登錄表的**純函式**。時鐘當參數傳入，所以半小時過期可以用毫秒測完 |
| `index.ts` | socket、速率限制、靜態檔案、`/healthz` |
| `main.ts` | 正式環境進入點 |

## `scripts/` — 資產管線與發版

| 檔案 | 職責 |
|---|---|
| `extract_poses.py` | 從角色卡切出 12×30 = 360 張姿勢圖 |
| `extract_skill_assets.py` | 從必殺技表切出 226 張技能圖 |
| `generate_skill_contact_sheets.py` | 產生對照表 — **看懂每個圖格是什麼的唯一方法** |
| `validate_pose_regeneration.py`、`validate_skill_assets.py` | SHA-256 基準驗證 |
| `gen-skill-cells.mjs` | manifest → `src/fighters/skillCells.ts` |
| `release.mjs`、`release-notes.mjs` | 發版流程 |
| `upgraded-acceptance/` | upgraded build 交付的 QA 腳本。**跑不起來**（它們斷言的是未移植的原始碼），留作規格參考 |

詳見 [美術資產與管線](client/art-pipeline.md)。

## `public/assets/`

| 目錄 | 內容 |
|---|---|
| `cards/` | 12 張全解析度角色卡（26 MB），只在切圖時讀 |
| `thumbs/` | 12 張縮圖 WebP（0.55 MB），選單用 |
| `poses/` | 360 張姿勢圖 |
| `skills/` | 226 張技能圖 |
| `ultimate-backgrounds/` | 12 張大招背景 |

## `audit/`

資產管線的產出紀錄：manifest、SHA-256 基準、裁切設定、對照表。`audit/skill-assets/contact_sheets/` 是查「某隻角色的 K 是什麼」時該開的地方。

## 根目錄

| 檔案 | 職責 |
|---|---|
| `vite.config.ts` | 客戶端打包 |
| `tsconfig.json` / `tsconfig.server.json` | 兩個 build 的設定 |
| `vitest.config.ts` | 單元測試；`environment: 'node'` 是刻意的 |
| `playwright.config.ts` | e2e；預設起真實的正式伺服器 |
| `Dockerfile`、`render.yaml`、`fly.toml` | 部署 |
| `FIX_NOTES.md` | 每個版本的說明，發版時逐字採用 |
