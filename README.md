# MEME CAT FIGHTER／迷因貓大亂鬥

A fully client-side 2D browser fighting-game demo built with Phaser 4, TypeScript, Vite and intentionally absurd low-resolution meme-cat character cards.

The eight supplied character sheets are loaded as full cards for character selection and are also processed at runtime by `SpriteExtractor`. It crops the 13 action panels, removes near-black pixels, trims transparent margins and creates Phaser CanvasTextures for combat poses.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- Desktop browser: Chrome, Edge or Firefox

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

Open the Vite URL printed in Terminal, normally `http://localhost:5173`.

## Production Build

```bash
npm run build
npm run preview
```

## Controls

### Menus

- P1 cursor: `W A S D`
- P1 confirm: `F`
- Back: `G` / `Esc`
- P2 character cursor: Arrow keys
- P2 confirm: `J`
- Mute: `M`

### Player 1 Battle

- Move: `A / D`
- Jump: `W`
- Crouch: `S`
- Light: `F`
- Heavy: `G`
- Special: `H`
- Ultimate: `S + H` when MEME = 100
- Block: hold away from the opponent

### Player 2 Battle

- Move: `← / →`
- Jump: `↑`
- Crouch: `↓`
- Light: `J`
- Heavy: `K`
- Special: `L`
- Ultimate: `↓ + L` when MEME = 100
- Block: hold away from the opponent

### Debug / Pause

- `F2`: hitboxes, hurtboxes, FPS and fighter states
- `Esc`: pause / resume
- While paused, `Q`: main menu
- `M`: mute / unmute

## Online Play

```bash
npm run build          # client bundle
npm run build:server   # server
npm run dev:server     # serves both on http://localhost:8080
```

One process serves the client and the WebSocket on the same origin, so the page
connects to `/ws` with no configuration. Pick `ONLINE VS`, create a room, and read
the six-character code to a friend; they choose `ONLINE VS`, press `J`, and type
it. Both players use the P1 controls on their own keyboard.

Matches run input-delay lockstep: only button state crosses the wire, and both
clients run the same deterministic simulation. They exchange a checksum every
second, so a divergence is reported rather than left to show up as two screens
quietly disagreeing.

## Game Modes

- `1P VS CPU`: Easy / Normal / Hard finite-state CPU AI
- `2P VS P2`: two players on one keyboard
- `ONLINE VS`: two players on different machines, matched by room code
- Best of 3, 60 seconds per round
- All fighters always display 100 HP; card HP stat influences identity/balance indirectly rather than changing the visible health maximum

## Characters

1. 崩潰喵喵貓 — 崩潰音波 / JPEG震爆
2. 哭哭預警貓 — 哭哭水柱 / 情緒海嘯
3. OK老大貓 — OK衝刺 / 超級OK判定
4. 尷尬微笑貓 — 尷尬僵直 / 社死領域
5. 厭世沙拉貓 — 沙拉掀桌 / 健康餐大爆扣
6. 震驚口水貓 — 冰櫃滑步 / 冷凍驚嚇
7. 外星電波貓 — 電波光束 / 地球人退散
8. 魔法胖橘貓 — JPEG魔法陣 / 爆裂喵法會

## Project Structure

```text
src/
├─ main.ts
├─ gameConfig.ts
├─ scenes/
│  ├─ BootScene.ts
│  ├─ TitleScene.ts
│  ├─ ModeSelectScene.ts
│  ├─ CharacterSelectScene.ts
│  ├─ VsScene.ts
│  ├─ BattleScene.ts
│  └─ ResultScene.ts
├─ fighters/
│  ├─ Fighter.ts
│  ├─ FighterState.ts
│  ├─ FighterConfig.ts
│  └─ fighterData.ts
├─ combat/
│  ├─ CombatSystem.ts
│  └─ AttackSpec.ts
├─ controllers/
│  ├─ Controller.ts
│  ├─ PlayerController.ts
│  └─ CPUController.ts
├─ systems/
│  ├─ SpriteExtractor.ts
│  ├─ AudioManager.ts
│  ├─ VFXManager.ts
│  └─ GameState.ts
├─ ui/
│  ├─ BattleHUD.ts
│  ├─ HealthBar.ts
│  └─ MemeMeter.ts
├─ stages/
│  └─ StageRenderer.ts
└─ utils/
   └─ constants.ts
```

## Adding New Fighters

1. Add the new card under `public/assets/cards/` using the same 1122×1402 action-sheet layout.
2. Add one `FighterConfig` entry in `src/fighters/fighterData.ts`.
3. Define its Special and Ultimate as data-driven `AttackSpec` entries.
4. If the new move needs a completely new behavior category, add one reusable `AttackKind` and one handler in `CombatSystem`; do not duplicate the `Fighter` engine.

## Card Art

`public/assets/cards/` holds the eight source cards at full resolution. They are
only ever *displayed* at 238x298 or smaller, so the menus load downscaled WebP
thumbnails from `public/assets/thumbs/` instead — about 0.55 MB rather than
26 MB. The full card is fetched only when a match needs it, because pose
extraction reads its pixels.

Regenerate the thumbnails after changing a card (requires `cwebp`):

```bash
npm run assets:thumbs
```

The source cards stay PNG deliberately. Lossy WebP shrinks them by 90%, but it
moves about 1% of pixels across the `RGB < 25` threshold that pose extraction
uses to cut the background away, which leaves a dark fringe around every fighter.
Lossless WebP is pixel-identical and roughly 35% smaller, if the download matters
more than keeping the originals in a universally-editable format.

## Runtime Pose Extraction

`SpriteExtractor` maps the card panels to:

`idle`, `walkForward`, `walkBack`, `jump`, `crouch`, `light`, `heavy`, `block`, `hit`, `special`, `ultimate`, `victory`, `ko`.

It intentionally uses a conservative near-black threshold (`RGB < 25`) so dark character details such as the wizard cat's hat survive. Rough JPEG edges are part of the intended presentation.
