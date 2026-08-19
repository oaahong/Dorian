# MEME FIGHT／迷因大亂鬥

Phaser 3.90 + TypeScript + Vite 的 12 角色瀏覽器 2D 格鬥遊戲。戰鬥核心維持固定 60Hz `CombatClock`；本版是在既有系統上加入 **Chargeable Special H、Meme Ultimate 輸入狀態機、Cut-in Presentation、12 個 Gameplay Ultimate Runtime，以及獨立 Skill Asset Pipeline**，沒有建立第二套 Combat/Input 核心。

## Install / Run

建議先用目前作業系統重新建立依賴，不要直接沿用其他平台打包的 `node_modules`：

```bash
rm -rf node_modules
npm ci
npm run dev
```

Production：

```bash
npm run typecheck
npm run build
```

若來源 ZIP 內附的 `node_modules` 與目前 OS 不相容，Rollup/Vite 可能缺少平台 native optional dependency。這是 dependency environment 問題；請以 `npm ci` 重建，**不要修改遊戲 source 來繞過 Rollup/Vite**。

## Fighters / Ultimate Name

1. Alien Meow／訊號壞掉喵 — **逼逼逼動感光波**
2. Doge — **超級賽狗**
3. YA鼠 — **哈ㄗ咖西**
4. oh fucking 天婦羅尬哩涼 — **oh fucking 天婦羅尬哩涼！**
5. 哥布林也想談戀愛 — **長老您保重**
6. 沙拉貓貓 — **菜就多練**
7. 魔法胖橘貓 — **喵蘇魯的召喚！**
8. 我的刀盾 — **汪爆氣流斬**
9. 粉紅星星 — **派甜心假面...露出**
10. 蘸醬胡渣狗 — **胡渣男！**
11. 驚嚇小貓 — **嗷嗷嗷嗷嗷！！**
12. OK喵老大 — **大哥你是了解我的**

每個角色在資料層只保留唯一玩家可見 `ultimateName`；Gameplay 內部以 Runtime ID 區分實作。

## Controls

### P1

- `WASD`：移動 / 跳 / 蹲
- `F`：既有 Light
- `G`：既有 Heavy
- `H`：**bare H = 新 Chargeable Special H**
- `R`：Throw
- `T`：Meme Charge / Ultimate
- `G + H`：Meme Impact
- `F + H`：Meme Parry
- `F + G`：Meme Rush
- `236 + H`：原 Special 1
- `214 + H`：Special 2
- `623 + H`：Special 3（角色有設定時）
- `22 + H`：Function

### P2

- `↑↓←→`：移動 / 跳 / 蹲
- `J`：既有 Light
- `K`：既有 Heavy
- `L`：**bare L = 與 P1 bare H 相同的 logical `SPECIAL_H`**
- `U`：Throw
- `I`：Meme Charge / Ultimate
- `K + L`：Meme Impact
- `J + L`：Meme Parry
- `J + K`：Meme Rush
- `236 / 214 / 623 / 22 + L`：對應既有 Special 1 / 2 / 3 / Function

### Chargeable H

- `< 0.40s`：Lv1
- `0.40s ～ < 0.90s`：Lv2
- `>= 0.90s`：Lv3；繼續按住不會自動 Release
- 必須放開 Special 才施放
- Charging 時不能走、跳、普通攻擊、Throw、其他 Special 或 Guard
- 真正受擊 / Throw 會取消 Charge；Block / Parry / Armor 成功不會誤取消
- **H 完全沒有 Cooldown；Recovery 結束立刻回 IDLE，下一個 bare Special pressed edge 可立即再次蓄力**

驚嚇小貓 H 已改為面向方向的「驚嚇衝撞」，strike hitbox 跟隨本體，Lv1/Lv2/Lv3 knockback 為 `120 < 190 < 280`。

### Meme Ultimate

玩家的 T / I 是輸入協議，不是 CPU 協議：

```text
Hold T/I -> +5 MEME / second
100 while still held -> READY_WAIT_RELEASE
Release -> READY_WAIT_PRESS
new pressed edge -> consume 100 once -> Cut-in -> Gameplay Runtime
```

若 Meter 是由戰鬥 / Training 等來源在按鍵未 held 時到 100，直接進 `READY_WAIT_PRESS`。若 Ready 後 Meme 被 Impact / Rush 等消費掉，Ready 立即取消。CPU 不模擬 hold/release；Meter=100 且 AI 條件成立時直接要求 logical Ultimate，但之後使用同一套 Cut-in + Gameplay Runtime。

## Ultimate Architecture

- `UltimateCutInManager`：只做 Background / Character / Bubble / Voice Text / Title / Flash / Glitch / Shake / Transition，**不產生 Hitbox**。
- Cut-in 時 Phaser Scene update / Tween / Cut-in presentation 繼續運作，只停止 fixed combat simulation、Round Timer 與 gameplay entity tick。
- `UltimateAttack`：現在只負責 Arena Gameplay Ultimate Runtime，不再同時負責舊 fullscreen title overlay；舊 Ultimate Pattern schema 已從正式 move data 移除，避免雙重 Hitbox / 雙重傷害。
- Doge、Goblin、SwordShield、PinkStar 的 Install 在 Transformation Peak 後，Fighter body 固定為 normal `2.0×`，feet baseline 保持；hurtbox 重新配合身體。退出 Install / KO / Round End / Reset 時恢復 `1.0×`。
- 刀盾 Ultimate 的來源 K cell 內兩把劍會在 skill pipeline 以空間分離方式衍生為兩個獨立 weapon module，分別掛在 left/right weapon socket；沒有生成第三把劍。

## Skill Asset Pipeline

原本 12×30 = 360 Base Fighter Pose pipeline 保持不變：

```bash
python3 scripts/extract_poses.py
```

新 H / Ultimate sheet 使用**第二條** pipeline：

```bash
npm run assets:skills
npm run assets:skills:validate
npm run assets:skills:contacts
```

來源備份：

- `asset_pipeline_backups/skill-sheets-source.zip`
- `asset_pipeline_backups/ultimate-backgrounds-source.zip`
- `asset_pipeline_backups/project-working-source.zip`

輸出：

- `public/assets/skills/<fighter>/...`
- `public/assets/ultimate-backgrounds/<fighter>.webp`
- `scripts/skill_crop_config.json`
- `audit/skill-assets/skill-asset-manifest.json`
- `audit/skill-assets/validation.json`
- `audit/skill-assets/contact_sheets/`

目前 source sheet 共切出 **224 個 A/B/C… source cells**，另外從刀盾 K cell 原始像素合法拆出 **2 個獨立 sword weapon modules**，合計 226 個 RGBA gameplay assets。背景 12 張保持原始 RGB 比例，不強制 360×360。

Pipeline 只清除與 crop 外緣連通的背景與格線；不會把所有黑 / 白 / 灰像素粗暴刪除。原 360 Base Pose 另有 SHA-256 baseline，Skill generator 不會覆寫它們。

## QA

```bash
npm run typecheck
npm run test:static
npm run test:logic
npm run test:runtime
```

- `test:static`：檢查 360 Base Pose、Skill Manifest/Alpha/SHA、input precedence、H no-cooldown、Meme 狀態、唯一 Ultimate Name、Cut-in/Runtime 分離、2.0× Install、RenderTexture/Summon/Capture cleanup 等。
- `test:logic`：直接執行 transpiled 真實 `PlayerController`、`ChargeableSpecialH`、`UltimateInputState`，驗證 H Lv1/Lv2/Lv3、無 cooldown 立即再蓄、驚嚇小貓 knockback 遞增、T/I hold→release→new press、P1/P2 physical mapping 與 chord consume。
- `test:runtime`：Browser smoke test，包含 12 Cut-in / Runtime；需要允許 Chromium 存取本機測試頁的執行環境。

Training：`F2` debug、`F3` freeze CombatClock、`F4` +1 fixed combat frame、`F5` reset、`F6` dummy guard。
