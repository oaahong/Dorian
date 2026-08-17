# MEME CAT FIGHTER／迷因貓大亂鬥

A 2D browser fighting game built with Phaser 4, TypeScript and Vite, with
intentionally absurd low-resolution meme-cat character cards. Two players can
fight on one keyboard or across the internet.

The eight supplied character sheets are cut apart at runtime by `SpriteExtractor`,
which crops the 13 action panels, removes near-black pixels, trims transparent
margins and registers each pose as a Phaser CanvasTexture.

## Requirements

- Node.js 20.19+ or 22.12+ (22 for the server)
- npm
- Desktop browser: Chrome, Edge or Firefox

## Install

```bash
npm install
```

## Development

```bash
npm run dev          # client only, at http://localhost:5173
npm run dev:server   # client and signalling server together, at :8080
```

Use `npm run dev` for everything except online play — it has hot reload. Online
play needs the server, which `dev:server` builds and runs as one process.

## Testing

```bash
npm test             # unit, property, golden-replay and server tests
npm run test:e2e     # browser tests, including a full online match
npm run verify       # typecheck + both suites
```

The layers are tested where each is cheapest to pin down:

- **`src/sim`** — pure functions, no browser. Physics, frame data, hit resolution
  and round flow, plus property tests over random input and golden replays that
  snapshot a whole match as a trail of checksums.
- **`src/net`** — lockstep against a simulated link with latency, jitter, loss and
  reordering. Two clients, two worlds, and a requirement that they finish
  byte-identical. This is where desyncs get caught, because reproducing one by
  hand needs two machines and patience.
- **`server`** — room logic as pure functions with the clock passed in, so the
  half-hour expiry is tested in milliseconds, plus integration tests driving real
  sockets.
- **`e2e`** — the actual game in a browser, and a real online match between two
  browser contexts.

```bash
# Against a deployed instance, which is the only way to exercise TLS, the wss://
# upgrade and NAT traversal across a real network.
E2E_BASE_URL=https://<app> npm run test:e2e
```

## Controls

### Menus

- P1 cursor: `W A S D`
- P1 confirm: `F`
- Back: `G` / `Esc`
- P2 character cursor: Arrow keys
- P2 confirm: `J`
- Online lobby: `F` create a room, `J` join with a code, `Esc` leave
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

Online, both players use the Player 1 controls on their own keyboard; the seat the
server hands out decides which fighter they drive.

### Debug / Pause

- `F2`: hitboxes, hurtboxes and a status line
- `Esc`: pause / resume. Online it leaves the match instead, because pausing would
  stall the opponent indefinitely
- While paused, `Q`: main menu
- `M`: mute / unmute

The `F2` line reads:

```text
NET ok delay=4 stalled=0
FPS 60.0  TPS 60.0  TICK 431  PHASE fight
```

**`TPS` is the number that matters online, not `FPS`.** A client can render at
16 fps and still simulate a perfect 60 ticks per second, because the fixed-step
accumulator runs several ticks per frame. A match held up by the connection looks
healthy on `FPS` and is unplayable. A good match reads `NET ok` and `TPS 60`;
anything else says which part is at fault.

## Game Modes

- `1P VS CPU`: Easy / Normal / Hard finite-state CPU AI
- `2P VS P2`: two players on one keyboard
- `ONLINE VS`: two players on different machines, matched by room code
- Best of 3, 60 seconds per round
- All fighters always display 100 HP; card HP stat influences identity/balance
  indirectly rather than changing the visible health maximum

## Online Play

Pick `ONLINE VS`, create a room, and read the six-character code to a friend; they
choose `ONLINE VS`, press `J`, and type it.

Matches run **input-delay lockstep**: only button state crosses the wire — about
six bytes a tick — and both clients run the same deterministic simulation over
the same inputs. They exchange a checksum every second, so a divergence is
reported rather than left to show up as two screens quietly disagreeing.

The two clients try to connect **directly** to each other and fall back to routing
through the server only if that fails; the lobby shows which it got. It is worth
the trouble: two players in the same country are perhaps 10-15 ms apart directly
but 60 ms apart via a datacentre in another one, and the input delay is sized from
that number. Traversal uses public STUN — when it does not work, the relay that is
already connected takes over, so there is no TURN server to pay for.

That makes the server almost irrelevant to how the game feels. It hands out room
codes and passes a handful of negotiation messages, then steps out of the way.

Two limits worth stating plainly:

- **Lockstep has no server authority, so a modified client can cheat.** For room
  codes between friends that is an acceptable trade. Closing it means running the
  simulation on the server too, which the headless core already allows.
- **Both players wait for the slower one.** There is no rollback, so a client that
  cannot keep up holds the match back rather than being predicted through.

## Deploying

One process serves the client and the signalling socket on the same origin, so
there is no CORS or hostname configuration — `render.yaml` and `Dockerfile`
describe the whole deployment.

```bash
git push                      # then point Render at the repo as a Blueprint
curl https://<app>/healthz    # should answer "ok"
```

`fly.toml` is kept as an alternative. Note that it pins exactly one always-running
machine: rooms live in that process's memory, so an autoscaled second machine
would put the two players of a room on different boxes.

Because matches connect directly, the server is only needed for the few seconds it
takes to exchange a room code — which is why a free tier that sleeps when idle is
a reasonable trade here, and why its region barely affects how the game feels.

`VITE_WS_URL` points the client at a signalling server on another origin, if you
would rather serve the client from a CDN close to the players.

## Releasing

Deployment and release are separate here. Render deploys every commit on `main`,
so players always have the newest build; a release is the record of what that
build is — a version, a tag, and notes someone can read.

```bash
npm run release:patch   # bug fixes only
npm run release:minor   # new behaviour, nothing broken
npm run release:major   # something a player or a save has to adapt to
```

Write the FIX_NOTES section for the new version *first*. The release refuses to
start without it, on the grounds that notes written after the tag never get
written at all.

One command does the rest: full `verify`, bump `package.json` and the lockfile,
commit as `Release x.y.z`, annotated tag `vx.y.z`, push both. The tag triggers
`.github/workflows/release.yml`, which publishes a GitHub Release whose body is
that FIX_NOTES section verbatim — the notes live in the repo, not in a second
changelog generated from commit subjects.

It stops before touching anything if the tree is dirty, if you are not on `main`,
if `origin/main` is ahead, or if the version has no notes. Preview what would be
published with `npm run release:notes -- 1.4.2`.

Versions are [semver](https://semver.org), which is a promise to whoever depends
on your API — and nothing depends on this one, so in practice the number is a
label for humans. That is also why there is no release-please or
semantic-release: their main service is generating a changelog from commit
subjects, and FIX_NOTES is already better than what that produces.

## The upgraded build, and what is still to come

This branch merges the separately-delivered upgraded build (`project-working-upgraded`)
back into the trunk. Both descend from the initial commit and grew in opposite
directions: the trunk extracted the game into a deterministic simulation and put it
online, while the upgraded build stayed on the original object-oriented Phaser 3 code
and deepened the *fighting game* — twelve characters instead of eight, frame data with
armour and cancel rules, motion inputs, a chargeable H special, ultimates with cut-ins,
summons, and a training mode.

Nothing about that is expressible as a text merge, because the upgraded build extends
exactly the classes the trunk deleted (`Fighter`, `CombatSystem`, `controllers/`). So
the merge is staged:

- **This commit** brings in everything that does not fight the architecture: the 610
  art assets (360 poses, 226 skill cells, 12 ultimate backgrounds, 12 cards), the twelve
  source character sheets, and the Python asset pipeline that regenerates them.
- **The port** re-expresses the upgraded gameplay in `src/sim`, so it keeps working
  under lockstep. Frame-based timing is the *better* fit here — the trunk's own
  `AttackSpec` is authored in milliseconds and rounded to ticks.

The upgraded build's own documentation is kept verbatim at
[docs/upgraded-build.md](docs/upgraded-build.md); it is the specification for the port,
not a description of this tree. Its delivered QA suite is kept at
[scripts/upgraded-acceptance/](scripts/upgraded-acceptance/) for the same reason — those
scripts assert against the un-ported source, so they do not run yet, but between them
they pin down the roster, the ultimate names, the charge thresholds and the input
precedence that the port has to reproduce.

The characters below are the trunk's current eight. The port replaces them with the
upgraded twelve listed in [docs/upgraded-build.md](docs/upgraded-build.md).

## Characters

1. 崩潰喵喵貓 — 崩潰音波 / JPEG震爆
2. 哭哭預警貓 — 哭哭水柱 / 情緒海嘯
3. OK老大貓 — OK衝刺 / 超級OK判定
4. 尷尬微笑貓 — 尷尬僵直 / 社死領域
5. 厭世沙拉貓 — 沙拉掀桌 / 健康餐大爆扣
6. 震驚口水貓 — 冰櫃滑步 / 冷凍驚嚇
7. 外星電波貓 — 電波光束 / 地球人退散
8. 魔法胖橘貓 — JPEG魔法陣 / 爆裂喵法會

## Architecture

The one rule everything else follows: **`src/sim` never imports Phaser, and
`src/render` never writes to simulation state.**

That split is what makes online play possible at all. Lockstep needs the same
inputs to produce the same state on both machines, which means the simulation
cannot touch a wall clock, a frame delta, `Math.random`, or a rendering library.
It also means the simulation runs headless in Node, so most of the game is tested
without a browser. Sound, particles and screen shake stay as random and as
frame-rate-dependent as they like, because they sit on the other side of the line
and cannot affect what the opponent computes.

`src/sim/__tests__/purity.test.ts` enforces it: no Phaser import, no `Date.now`,
no `Math.random`, no transcendental function. These would be lint rules in a
project that had ESLint; the reasoning is worth more next to the assertion.

```text
src/
├─ sim/                    the game, as pure data and pure functions
│  ├─ world.ts             stepWorld(world, [p1, p2]) -> SimEvent[]
│  ├─ fighter.ts           physics and the per-fighter state machine
│  ├─ combat.ts            boxes, blocking, damage
│  ├─ attackSpecs.ts       frame data, converted from milliseconds to ticks
│  ├─ cpu.ts               the AI, seeded so a 1P match replays
│  ├─ input.ts             one byte of raw buttons — the network payload
│  ├─ rng.ts hash.ts       seeded xorshift32, FNV-1a for desync detection
│  ├─ constants.ts types.ts
│  └─ __tests__/           unit, property and golden-replay tests
├─ net/                    lockstep and transports
│  ├─ Session.ts           "can this tick run yet?" — the whole seam
│  ├─ LockstepSession.ts   input delay, retransmission, checksums
│  ├─ LocalSession.ts      the offline answer: always yes
│  ├─ Transport.ts         four methods, so the session never sees a socket
│  ├─ WebRtcTransport.ts   direct peer connection
│  ├─ OnlineClient.ts      one socket for lobby traffic and the relay fallback
│  └─ protocol.ts          JSON for the lobby, binary for gameplay
├─ render/                 reads SimWorld, owns every Phaser object
│  ├─ BattleView.ts        turns SimEvents into sound, sparks and announcements
│  ├─ FighterView.ts       sprite, pose and the cosmetic wobble
│  ├─ CombatView.ts        projectiles and zones, keyed by simulation entity id
│  └─ KeyboardSampler.ts   raw buttons, latched so fast taps survive
├─ scenes/                 Phaser scenes: menus, lobby, and the battle loop
├─ fighters/ combat/       roster and frame data (plain data, shared with sim)
├─ systems/ ui/ stages/    sprite extraction, audio, HUD, backgrounds
└─ utils/constants.ts      colours and fonts; gameplay values live in sim

server/                    relay and room registry — it does not simulate
├─ rooms.ts                pure functions, clock passed in
├─ index.ts                sockets, rate limiting, static files
└─ main.ts                 production entry point

e2e/                       Playwright: the real game, and a real online match
docs/sim-spec.md           the simulation's rules, with citations
```

### One repo, two builds, one shared core

`npm run build` bundles the client with Vite into `dist/`; `npm run build:server`
compiles the server with `tsconfig.server.json` into `build/`. The `Dockerfile`
runs both, which is why deploying looks like one artefact.

The server is a separate build rather than a separate codebase, because both ends
have to agree on things neither can decide alone. It imports `src/net/protocol`
for the wire format, `src/net/roomCode` for the alphabet a code is validated
against, and `src/sim/rng` to draw seeds and stages — and `protocol` in turn reads
`src/sim/input` and `src/sim/types`. Duplicating any of those would mean a wire
format that can drift on one side only, which lockstep would report as a desync
somewhere else entirely.

`tsconfig.server.json` includes all of `src/sim`, `src/fighters` and `src/combat`
even though today's server only reaches the corners above: `sim` pulls the roster
and frame data transitively, and the whole point of keeping it Phaser-free is that
the server *could* run it — the escape hatch for the cheating limitation above.

Two consequences that look arbitrary until you know the cause:

- **The server is emitted as CommonJS**, in an ES module package. The shared code
  is written for a bundler, so its relative imports carry no `.js` suffix; CommonJS
  and `Node10` resolution accept that, ESM would need every import in `src/sim` and
  `src/net` rewritten to suit one of its two consumers. `dev:server` and the
  `Dockerfile` both drop a `{"type":"commonjs"}` marker into `build/` so Node reads
  the output that way.
- **Three files in `src/net` are excluded**: `OnlineClient`, `onlineMatch` and
  `WebRtcTransport` touch `location` and `RTCPeerConnection`. The server loads
  none of them, and including them would drag the DOM lib into a Node build.

Nothing in the split is load-bearing on running in one process. `startServer` takes
`staticDir: null` for an API-only server, and `VITE_WS_URL` points a separately
hosted client at it; serving both from one origin is the default because it needs
no configuration, not because the halves are entangled.

## Adding New Fighters

1. Add the new card under `public/assets/cards/` using the same 1122×1402
   action-sheet layout, then run `npm run assets:thumbs`.
2. Add one `FighterConfig` entry in `src/fighters/fighterData.ts`.
3. Define its Special and Ultimate as data-driven `AttackSpec` entries.
4. If the move needs a genuinely new behaviour, add one reusable `AttackKind` and
   one handler in `src/sim/world.ts`; do not duplicate the fighter engine.
5. Run `npm test`. The roster tests check the shape of the new entry, and the
   golden replays will flag any change to existing behaviour.

Anything added to the simulation has to obey the determinism rules — see
`docs/sim-spec.md` §10 for the list and why each one matters.

## Card Art

`public/assets/cards/` holds the eight source cards at full resolution. They are
only ever *displayed* at 238x298 or smaller, so the menus load downscaled WebP
thumbnails from `public/assets/thumbs/` instead — about 0.55 MB rather than 26 MB,
which took boot from 1495 ms to 754 ms. The full card is fetched only once a match
knows which two fighters it needs, because pose extraction reads its pixels.

Regenerate the thumbnails after changing a card (requires `cwebp`):

```bash
npm run assets:thumbs
```

The source cards stay PNG deliberately. Lossy WebP shrinks them by 90%, but
measuring its effect on the `RGB < 25` threshold that pose extraction uses showed
about 1% of pixels crossing it — and crossing the wrong way, leaving background
the extractor no longer removes. Lossless WebP is pixel-identical (0 pixels
changed, measured the same way) and roughly 35% smaller, if the download matters
more than keeping the originals in a universally-editable format.

## Runtime Pose Extraction

`SpriteExtractor` maps the card panels to:

`idle`, `walkForward`, `walkBack`, `jump`, `crouch`, `light`, `heavy`, `block`,
`hit`, `special`, `ultimate`, `victory`, `ko`.

It intentionally uses a conservative near-black threshold (`RGB < 25`) so dark
character details such as the wizard cat's hat survive. Rough JPEG edges are part
of the intended presentation.

Extraction runs in `PrepareMatchScene`, for the two fighters in the match only —
26 canvas passes rather than the 104 it used to do at boot.
