# 美術資產與管線

兩條 Python 管線，836 張圖，一條「每張都必須被用到」的規則。

## 全部資產

| 目錄 | 數量 | 產生者 |
|---|---|---|
| `asset_pipeline_backups/cards/` | 12 | 原始角色卡（26 MB），只在切圖時讀，**不在 `public/` 底下** |
| `public/assets/thumbs/` | 12 | `assets:thumbs`（WebP 縮圖，0.55 MB） |
| `public/assets/poses/` | **360** | `extract_poses.py`（WebP，7.5 MB） |
| `public/assets/skills/` | **226** | `extract_skill_assets.py`（WebP，2.5 MB） |
| `public/assets/ultimate-backgrounds/` | 12 | 技能管線（裁切後的 WebP，2.4 MB） |
| `asset_pipeline_backups/png-originals/` | 598 | 轉檔前的 PNG，保留但不部署 |

`public/assets/` 從 112 MB 降到 14 MB，一場對戰的素材下載從 12.3 MB 降到最壞 2.1 MB。

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

- `public/assets/skills/<fighter>/A..W.webp`
- `public/assets/ultimate-backgrounds/<fighter>.webp`
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

## 輸出格式：WebP q85

格式與品質定義在 [`scripts/asset_format.py`](../../scripts/asset_format.py)，三個腳本共用。改 q 值是改一個常數，不是改八個地方。

**q85 是看圖決定的，不是查表決定的。** 跑 `npm run assets:calibrate` 會在 `audit/webp-calibration/` 產生對照表（產生物，不進版本庫）：每個候選品質一欄，取 PSNR 最差的六張當列 — **不是字母序前六張，因為決策取決於最糟的那幾張**。pose 那張表以變身放大後的 500 px 呈現，因為 `INSTALL_BODY_SCALE = 2` 會把 360 px 的原圖放大到 1.39 倍，缺陷也跟著放大。

兩個不能隨便動的參數：

- **`alpha_quality=100`** 讓 alpha 通道無損。實測 586 張全部逐位元組相同 — 而 `validate_pose_regeneration.py` 與 `validate_skill_assets.py` 都斷言「至少一個完全透明的像素」。有損 alpha 會把這兩個驗證器變成偶爾紅的測試。
- **`method=4`** 是壓縮強度。實測 360×360 的 pose：method 6 要 3088 毫秒、method 4 要 59 毫秒，而 method 6 只小 2.6%。全套 586 張是半小時對三十五秒，換 230 KB — 不划算。

### 大招背景是裁切，不是縮放

背景原圖 1672×941，但 cut-in 把它置中畫在 1280×720 的畫布上，scale 從 1.05 補間到 **1.0**。靜止在 1.0 時，看得到的恰好是正中央的 1280×720 — **1:1 像素對映**。唯一會伸出去的是 glitch 抖動的 ±4 px。

所以能被看到的最大範圍是 1288×720，而**原圖有 40% 的面積從來沒出現在任何螢幕上**。裁到 1296×728 是零視覺差異的。

**必須是裁不是縮**：既然靜止時已經是 1:1，縮小只會讓它變糊。

## 卡片為什麼還是 PNG

有損 WebP 能把它們縮小 90%，但實測它對切圖用的 `RGB < 25` 閾值有影響：約 1% 的像素越過門檻，而且是往錯的方向越 — 留下切圖器不再會移除的背景。

無損 WebP 是像素完全相同（用同樣方法量到 0 個像素改變）且小約 35%，如果下載量比「保留通用可編輯格式的原檔」更重要，可以換。

**這個結論只適用於卡片，不適用於 pose / skill / 背景** — 那三類就是有損 WebP。差別在它們處在管線的哪一端：卡片是**輸入**，會再被閾值判斷一次，所以動它的像素就是動切圖器的下刀位置；另外三類是**終端輸出**，下游沒有任何閾值，只有 GPU 把它畫出來。

延伸閱讀：[渲染層](rendering.md)、[大招與變身](../gameplay/ultimates-and-installs.md)。
