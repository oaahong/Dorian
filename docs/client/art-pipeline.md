# 美術資產與管線

兩條 Python 管線，836 張圖，一條「每張都必須被用到」的規則。

## 全部資產

| 目錄 | 數量 | 產生者 |
|---|---|---|
| `public/assets/cards/` | 12 | 原始角色卡（26 MB），只在切圖時讀 |
| `public/assets/thumbs/` | 12 | `assets:thumbs`（WebP 縮圖，0.55 MB） |
| `public/assets/poses/` | **360** | `extract_poses.py` |
| `public/assets/skills/` | **226** | `extract_skill_assets.py` |
| `public/assets/ultimate-backgrounds/` | 12 | 技能管線 |

## 為什麼是離線切圖

以前是在瀏覽器裡切的：`SpriteExtractor` 每個角色抓一張數 MB 的 PNG，用同步 canvas 切出十三格，然後比賽才能開始。

離線做在每個面向都更好：

- 裁切矩形與 alpha 閾值**跟它們被調校時對著的那張圖放在一起**
- 切壞了會出現在對照表上，而不是出現在動起來的角色身上
- 客戶端把最初幾影格花在繪製而不是切圖上（開機時間從 1495 毫秒降到 754 毫秒）

它也順便終結了執行期切圖器跟自己吵了很久的一場架。單純的「接近純黑就是背景」測試會清掉背景，但也會清掉貓的瞳孔 — 因為瞳孔一樣黑。解法是**從裁切邊緣往內做 flood fill**，所以被包圍的暗部永遠不會被碰到。管線離線做同一件事，只做一次。

## 兩條管線

### 姿勢（360 張）

```bash
npm run assets:poses
npm run assets:poses:validate
```

12 角色 × 30 格。[`poseSheet.ts`](../../src/fighters/poseSheet.ts) 把渲染器要的姿勢名稱對到圖號。**十二張表裡有十一張共用同一種排列**；`alien` 是用不同順序拍的，所以它有自己的一份。

### 技能（226 張）

```bash
npm run assets:skills            # 切圖，然後重新產生圖格表
npm run assets:skills:validate
npm run assets:skills:contacts   # 產生對照表
```

輸出：

- `public/assets/skills/<fighter>/A..W.png`
- `public/assets/ultimate-backgrounds/<fighter>.png`
- `audit/skill-assets/skill-asset-manifest.json`
- `audit/skill-assets/contact_sheets/`

其中 224 張是從來源表切出的圖格，另外 2 張是從刀盾的 `K` 格以空間分離衍生出的獨立武器模組。

## 圖格是格子位置，不是語意

**`A`–`C` 永遠是蓄力三段前搖，`D` 永遠是釋放。** 從那之後，一個字母代表什麼**每隻角色都不一樣** — `alien` 的 `I` 是施法的貓，`goblin` 的 `I` 是哭喊的哥布林，`salad` 的 `I` 是抱著沙拉盤的貓。

**要知道某個圖格是什麼，去開 [`audit/skill-assets/contact_sheets/`](../../audit/skill-assets/contact_sheets/)。** 對照表上每一格都標了字母與分類。動任何一張對照表之前先開它。

管線把圖格分成四類：

| 分類 | 數量 | 意義 |
|---|---|---|
| `H_CHARGE_FIGHTER` | 36 | 蓄力三段（A/B/C） |
| `H_RELEASE_FIGHTER` | 12 | 釋放（D） |
| `H_OR_SHARED_VFX` | 36 | 蓄力三段的特效（E/F/G） |
| `ULTIMATE_MODULE` | 140 | 大招演出的所有素材 |
| `WEAPON` | 2 | 刀盾的兩把衍生劍 |

## 每張圖各自的歸屬

| 用途 | 定義在 |
|---|---|
| 這隻角色有哪些圖格 | [`skillCells.ts`](../../src/fighters/skillCells.ts) — **產生檔** |
| 蓄力三段的特效 | [`effectCells.ts`](../../src/render/effectCells.ts) |
| 大招的拍點與本體圖 | [`ultimateVisuals.ts`](../../src/fighters/ultimateVisuals.ts) |
| 變身後的姿勢與掛載武器 | [`installPoses.ts`](../../src/fighters/installPoses.ts) |
| 召喚物的姿勢 | [`summonArt.ts`](../../src/fighters/summonArt.ts) |
| Cut-in 立繪 | 由大招本體圖推導 |

## 「每張都要被用到」是一條測試

[`skillAssetCoverage.test.ts`](../../src/render/__tests__/skillAssetCoverage.test.ts) 斷言 226 張裡的每一張都被上表某處引用，並且會**指名道姓**地報出沒人畫的那些。

這條規則存在，是因為在 v2.0.0 之前有 **176 張圖從來沒進過瀏覽器**。它們躺在 `public/assets/skills/` 裡，客戶端每個角色只要四格，其餘全部畫成純色矩形。

**存在卻永遠不被畫的美術，跟根本沒畫過的美術看起來一模一樣** — 差別只在有人為它付過錢。而這條規則真正防的不是那次疏漏，是下一次：某個人往表裡加一張圖、重新產生 manifest，然後沒有任何東西告訴他沒人畫它。

### 唯一的例外

`blade/K` 是**兩把劍在同一張圖裡**。管線把它拆成 `K_weapon_blue` 與 `K_weapon_black`，掛在變身身體的左右手掛點；交付說明明文寫著「沒有生成第三把劍」。畫它會讓畫面上出現三把劍，所以它保持它本來的身分 — 那兩個模組的來源母圖。

測試裡另有一條斷言：**例外清單只能有一項**。一個會成長的例外清單，正是「全部都有用到」悄悄變成「除了那十四張我們放棄的以外都有用到」的方式。

## 單一真相與 codegen

`skillCells.ts` 由 `scripts/gen-skill-cells.mjs` 從 manifest 產生。manifest 是 163 KB 的裁切矩形與 SHA 摘要，瀏覽器一個位元都不需要。

手抄一份會**無聲地漂移** — 少一筆就是一張永遠不載入的資產、一個永遠不繪製的貼圖。所以測試會讀 manifest 本身並比對產物：重跑 `npm run assets:skills` 之後忘了 codegen，會紅。

## 卡片為什麼還是 PNG

有損 WebP 能把它們縮小 90%，但實測它對切圖用的 `RGB < 25` 閾值有影響：約 1% 的像素越過門檻，而且是往錯的方向越 — 留下切圖器不再會移除的背景。

無損 WebP 是像素完全相同（用同樣方法量到 0 個像素改變）且小約 35%，如果下載量比「保留通用可編輯格式的原檔」更重要，可以換。

延伸閱讀：[渲染層](rendering.md)、[大招與變身](../gameplay/ultimates-and-installs.md)。
