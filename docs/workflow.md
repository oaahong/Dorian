# 開發工作流

日常開發、加東西、發版。

## 跑起來

```bash
npm install
npm run dev          # 只有客戶端，:5173，有熱重載
npm run dev:server   # 客戶端 + 信令伺服器，:8080
```

除了連線對戰以外都用 `npm run dev`。連線需要伺服器，而 `dev:server` 會把兩者建成一個行程。

## 動手前後

```bash
npm run typecheck
npm test             # 快，數秒
npm run verify       # typecheck + 單元 + e2e，數分鐘
```

送 PR 之前跑 `verify`。CI 跑的是同一件事。

## 加一個角色

1. 把來源角色卡放進 `source-assets/`，把裁切設定加進 `audit/sheet-profiles.json`，然後 `npm run assets:poses` 切 30 張姿勢、`npm run assets:thumbs` 產選單縮圖
2. 在 [`fighterData.ts`](../src/fighters/fighterData.ts) 加一筆 `FighterConfig`
3. 用資料驅動的 `AttackSpec` 定義它的特殊技與大招 — 一個 236、一個 214、一個功能招，可選一個 623
4. 大招的判定加進 [`ultimateTimelines.ts`](../src/fighters/ultimateTimelines.ts)，美術加進 [`ultimateVisuals.ts`](../src/fighters/ultimateVisuals.ts)。兩者共用 tick 時基。若大招會變身，加一列 [`installPoses.ts`](../src/fighters/installPoses.ts)；若會留下召喚物，加一列 [`summonArt.ts`](../src/fighters/summonArt.ts)
5. 跑 `npm run assets:skills:codegen` 讓 [`skillCells.ts`](../src/fighters/skillCells.ts) 認得新的技能表。接著資產覆蓋率閘門會告訴你哪些圖格沒人畫
6. 若這張表不照標準姿勢順序，在 [`poseSheet.ts`](../src/fighters/poseSheet.ts) 加一份排列，像 `alien` 那樣
7. 若某招需要**真正的新行為**，加**一個**可重用的 `AttackKind` 和 `world.ts` 裡**一個** handler — 不要複製角色引擎
8. 加寬 [`CharacterSelectScene.ts`](../src/scenes/CharacterSelectScene.ts) 的 `GRID` — 那是一份定義，版面、游標環繞與高亮都由它推導
9. `npm test`。名單測試會檢查新條目的形狀，golden replay 會標出任何對既有行為的改動

任何加進模擬的東西都必須遵守決定性規則 — 見 [模擬核心規格 §10](gameplay/sim-spec.md#10-決定性規則)。

## 改美術

**動任何對照表之前，先開 [`audit/skill-assets/contact_sheets/`](../audit/skill-assets/contact_sheets/)。** 圖格是格子位置，一個字母代表什麼每隻角色都不一樣。

重跑切圖之後記得 `npm run assets:skills:codegen`（`npm run assets:skills` 已經包含它）。忘了的話覆蓋率測試會紅。

## 改模擬

三件事會擋你：

1. **`purity.test.ts`** — 不准 Phaser、時鐘、`Math.random`、超越函數
2. **Golden replay** — 任何行為改動都會動那串 checksum。判斷是回歸還是刻意，刻意的話重錄並在 commit 訊息說明
3. **覆蓋率門檻** — `src/sim` 95%

改到判定框或狀態的話，順手想一下 [`lockstep.install.test.ts`](../src/net/__tests__/lockstep.install.test.ts) 那種測試該不該加一條 — 伸進模擬的改動是唯一能造成 desync 的那類。

## CI

[`ci.yml`](../.github/workflows/ci.yml) 在 push 到 `main` 與每個 PR 上跑 `typecheck → test → e2e`。

Playwright 的瀏覽器與 `node_modules` 分開快取（約 150 MB，只在版本變動時才變）。

## 發版

**部署與發版是分開的。** Render 部署 `main` 上的每個 commit，所以玩家永遠拿到最新建置；**發版是「那個建置是什麼」的紀錄** — 一個版號、一個 tag，和一份人看得懂的說明。

```bash
npm run release:patch   # 只有修 bug
npm run release:minor   # 新行為，沒有破壞
npm run release:major   # 玩家或存檔必須適應的改動
```

**先寫新版本的 FIX_NOTES 段落。** 發版流程沒有對應段落會拒絕開始 — 理由是 tag 之後才寫的說明永遠不會被寫。

一個指令做完其餘的事：完整 `verify`、升 `package.json` 與 lockfile、commit 成 `Release x.y.z`、打 annotated tag `vx.y.z`、推兩者。tag 觸發 [`release.yml`](../.github/workflows/release.yml)，把那段 FIX_NOTES **逐字**發成 GitHub Release。

它在動任何東西之前會先停下來，如果：工作區髒、不在 `main`、`origin/main` 領先、或那個版號沒有說明。

用 `npm run release:notes -- 1.4.2` 預覽會發出去的內容。

> 發版必須在 `main` 上跑。流程會擋下其他分支，訊息是「Releases are cut from main — merge first」。

版號是 [semver](https://semver.org)，那是對依賴你 API 的人的承諾 — 而沒有人依賴這個 API，所以實務上它是給人看的標籤。這也是為什麼這裡沒有 release-please 或 semantic-release：它們主要的服務是從 commit 標題產生 changelog，而 FIX_NOTES 已經比那個產物好。

## 慣例

- **commit 訊息說「為什麼」**，不是「改了什麼」。diff 已經說了改什麼
- **按主題切 commit**，不要一坨
- 測試先寫，看它紅，再實作
- 關鍵測試用注入錯誤驗證過它會紅

延伸閱讀：[測試策略](testing.md)、[建置與部署](server/build-and-deploy.md)。
