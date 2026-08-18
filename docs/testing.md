# 測試策略

每一層在**最容易釘死它**的地方測。

## 五層

| 層 | 數量 | 用什麼 | 測什麼 |
|---|---|---|---|
| 模擬單元 | 21 檔 | vitest（node） | 物理、判定、回合流程、指令 |
| Golden replay | 1 檔 | vitest 快照 | 整場比賽壓成一串 checksum |
| 純淨性 | 1 檔 | vitest（掃原始碼） | 決定性規則 |
| 網路整合 | 5 檔 | vitest + 假連線 | 兩端在爛連線下位元相同 |
| 伺服器 | 4 檔 | vitest + 真 socket | 房間邏輯與 HTTP |
| 表現層純函式 | 4 檔 | vitest（node） | 該畫哪張圖、該放哪個拍點 |
| 瀏覽器 | 3 檔 | Playwright | 真實遊戲、真實連線對戰、效能 |

```bash
npm test          # 上面除了 Playwright 以外全部
npm run test:e2e  # Playwright
npm run verify    # typecheck + 兩者
```

## 為什麼單元測試跑在 node 而不是 jsdom

`vitest.config.ts` 寫死 `environment: 'node'`，而且註解講得很白：

> 如果這裡有任何測試需要 jsdom，那是 Phaser/DOM 漏進 `src/sim` 的訊號 — 去修那個漏洞，不要修設定。

覆蓋率門檻只加在**邏輯純粹的地方**：`src/sim` 要 95%，`server/` 要 85%。在渲染程式上量行覆蓋率會產生一個沒有意義的數字。

## Golden replay

一場腳本化的比賽，每 120 tick 取一次世界 checksum，整串存成快照。

**任何對物理、frame data、命中結算或回合流程的改動都會讓那串數字動。** 所以意外的行為改變會在這裡大聲失敗，而不是被玩家發現。

快照失敗時，先判斷是哪一種再跑 `-u`：

- 不預期的回歸，還是
- 刻意的平衡或時序改動 — 那就重錄，並在 commit 訊息裡說明

### 一個 replay 可能什麼都沒測到

名為「a transformation」的那條場景，跑了 doge 的變身 534 tick，而對手**一次都沒打中它**。`INSTALL_BODY_SCALE` 可以被改成任何值，所有快照都會照過。

所以新增的場景**用「實際命中次數」保護自己**：

```ts
expect(hitsTaken).toBeGreaterThan(0);
expect(checksums).toMatchSnapshot();
```

**一條停止測試任何東西的 replay，看起來跟一條通過的 replay 一模一樣。** 距離改一點點就足以讓它靜靜地失效。

## 純淨性測試

[`purity.test.ts`](../src/sim/__tests__/purity.test.ts) 逐檔掃 `src/sim` 的原始碼文字，違反決定性規則就紅：不得 import Phaser、不得讀時鐘、不得 `Math.random`、不得超越函數。

在有 ESLint 的專案裡這些會是 lint 規則。這裡選擇測試，因為理由可以寫在斷言旁邊 — 而**這些規則的違反是看不見的**：遊戲在本機跑得好好的，只有兩個客戶端連上時才會壞。

## 網路測試

[`linkHarness.ts`](../src/net/__tests__/linkHarness.ts) 是共用的雙端連線：虛擬時鐘、可重排的佇列、可容忍卡頓的步進迴圈，延遲／抖動／丟包全部由 seeded 產生器驅動。

**共用而不是各自複製一份**，因為一份複製裡的 bug 會變成一個「因為錯誤理由而通過」的測試。

涵蓋：完美連線、100ms、200ms 加抖動、2% 丟包、20% 丟包、四個變身大招在丟包下逐 tick 相同。

**desync 是最難手動重現的一類 bug** — 需要兩台機器、一條爛網路和耐心。所以它們在這裡被抓。

## 表現層怎麼被測

原則：**判斷邏輯抽成不 import Phaser 的純函式，Phaser 那側只負責畫。**

所以「這個角色現在該畫哪張圖」「這一影格該放哪些拍點」「蓄力第 N 段用哪張圖」全部在 node 裡測得到，剩下的薄殼交給 e2e。

## 資產覆蓋率閘門

[`skillAssetCoverage.test.ts`](../src/render/__tests__/skillAssetCoverage.test.ts) 斷言 226 張技能圖每一張都被某處引用，並**指名道姓**報出沒人畫的那些。唯一允許的例外是 `blade/K`，而且另有一條斷言：**例外清單只能有一項**。

理由見 [美術資產與管線](client/art-pipeline.md#每張都要被用到是一條測試)。

## 瀏覽器測試

三支：`smoke`（開機、選單、對戰、按鍵）、`online-match`（兩個瀏覽器情境打一場真的連線對戰）、`ultimates`（大招演出、變身、資源不洩漏）。

### 效能斷言的形狀是刻意的

大招那支同時是效能測試。它經歷過一次修正，值得記著：

原本斷言「大招期間的 tick 速率不得低於基線的 85%」。**那條斷言在一次發版時擋下了建置** — 而它是錯的，錯的不是程式。

連放五次大招測量之後：物件數 125 → 124、tween 2 → 0、貼圖 109 → 108，**什麼都沒累積**。而同樣那五個視窗的 tick 速率在閒置機器上從 **38 跳到 68**。±15% 的帶寬落在雜訊裡。

放寬門檻正是那條斷言上方註解警告過的失敗方式（降到不會紅為止）。所以改成**直接量洩漏本身**：

| 斷言 | 形式 |
|---|---|
| 演出期間 | 只設 stall 底線（十分之一速率），抓「模擬被卡死」 |
| 結束之後 | display objects、live tweens、textures 都必須回到基線 |
| 重複三次 | 因為**一次的任何東西都會無聲地洩漏** |

而且是**輪詢到靜止**而不是等固定秒數再取樣。第一版改法就是後者，被四個還在淡出的 tween 弄紅了 — 換了層皮的同一個錯誤。**斷言的是「最終會消失」，所以等它發生，等不到就 timeout。**

用注入洩漏驗證過：把 `UltimateStage` 改成不銷毀 sprite，兩條測試都會指名道姓地紅。

## Mutation 驗證

幾條關鍵測試被刻意「弄壞程式看它會不會紅」驗證過：

| 測試 | 注入的錯誤 |
|---|---|
| Golden replay（變身） | `INSTALL_BODY_SCALE` 改回 1 |
| 資產覆蓋率閘門 | 移除一個圖格引用 |
| 大招洩漏 | sprite 不再被銷毀 |

**一條從未見過紅燈的測試，不知道自己會不會紅。**

## 已知落差

**沒有 property-based 測試。** `fast-check` 在 `devDependencies` 裡但**沒有任何檔案 import 它**。README 提到的「property tests over random input」目前不成立 — 最接近的是 golden replay 與 seeded CPU 重播，那些是決定性重播而不是隨機性質檢驗。

要嘛補上（物理不變式與連段遞減是最自然的候選），要嘛把相依移掉。

延伸閱讀：[開發工作流](workflow.md)、[模擬核心規格 §10](gameplay/sim-spec.md#10-決定性規則)。
