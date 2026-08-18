# 建置與部署

兩個 build、一個容器、三個部署設定。

## 兩個 build

```bash
npm run build         # Vite 打包客戶端 -> dist/
npm run build:server  # tsc 編譯伺服器   -> build/
```

`Dockerfile` 兩個都跑，所以部署起來像一個產物。

伺服器是**另一個 build 而不是另一個 codebase**，理由在 [架構總覽](../architecture.md#一個-repo兩個-build一份共用核心)：兩端必須對線路格式、房號字母表與種子來源有共識，任何一份複製貼上都會變成單邊漂移的 desync。

`tsconfig.server.json` 把 `src/sim`、`src/fighters`、`src/combat` 全部納入，即使今天的伺服器只用到其中幾個角落 — `sim` 會遞移拉進名單與 frame data，而讓它保持 Phaser-free 的全部意義，就是伺服器**有可能**跑它。

## 兩個看起來很怪的決定

### 1. 伺服器輸出成 CommonJS，在一個 ES module 專案裡

共用程式是寫給打包器用的，所以它的相對 import 不帶 `.js` 副檔名。CommonJS 與 `Node10` 解析接受這種寫法；ESM 則需要把 `src/sim` 與 `src/net` 裡**每一個** import 改寫，只為了遷就兩個消費者其中之一。

所以 `dev:server` 與 `Dockerfile` 都會往 `build/` 丟一個 `{"type":"commonjs"}` 標記，讓 Node 用那種方式讀輸出。

### 2. `src/net` 有三個檔案被排除

`OnlineClient`、`onlineMatch` 與 `WebRtcTransport` 會碰 `location` 和 `RTCPeerConnection`。伺服器一個都不載入，而把它們包進去會把整個 DOM 型別庫拖進 Node build。

## 容器

多階段：build 階段編譯兩者，runtime 階段**只帶執行需要的東西** — 沒有原始碼、沒有開發相依。

```
build   : node:22-alpine, npm ci, build + build:server
runtime : node:22-alpine, npm ci --omit=dev, 複製 dist/ 與 build/
CMD     : node build/server/main.js   (EXPOSE 8080)
```

## 部署平台

### Render（主要）

[`render.yaml`](../../render.yaml) 是 Blueprint：把 Render 指向這個 repo，它讀這個檔而不是問你設定。

- Docker runtime、free 方案、`autoDeploy: true`
- 健康檢查 `/healthz`
- 區域 `singapore`

**區域的影響比看起來小**：比賽是直連的，所以這條路徑只承載房號交換，以及 NAT 擋掉直連的玩家所走的中繼後備。

### Fly（替代方案）

[`fly.toml`](../../fly.toml) 保留作為備案。注意它**釘死剛好一台常駐機器**：房間活在那個行程的記憶體裡，所以自動擴展出來的第二台會把同一房間的兩個玩家放在不同箱子上。詳見 [房間與狀態](rooms-and-state.md#這個決定的實際代價)。

### 分開託管

`VITE_WS_URL` 讓客戶端指向另一個來源的信令伺服器，適合想把客戶端放在靠近玩家的 CDN 上的情況。`startServer` 也接受 `staticDir: null` 以提供純 API 伺服器。

## CI

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) 在 push 到 `main` 與每個 PR 上跑：

```
typecheck → 單元測試 → （快取 Playwright 瀏覽器）→ e2e
```

單元測試那一步**必須保持快速且無頭** — 註解寫得很直接：如果這裡有任何東西需要瀏覽器，代表 Phaser 漏進 `src/sim` 了。

Playwright 的瀏覽器與 `node_modules` **分開快取**，因為那些二進位檔約 150 MB，而且只在 Playwright 版本變動時才改變。

[`release.yml`](../../.github/workflows/release.yml) 由 tag 觸發，把 FIX_NOTES 對應段落逐字發成 GitHub Release。

## 對著已部署的實例跑 e2e

```bash
E2E_BASE_URL=https://<app> npm run test:e2e
```

值得當作一等公民選項：**TLS、`wss://` 升級與跨真實網路的 NAT 穿透，正是 loopback 伺服器無法演練、而部署真正會壞掉的地方。**

延伸閱讀：[伺服器職責](responsibilities.md)、[開發工作流](../workflow.md)。
