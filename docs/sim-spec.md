# Simulation Spec

Extracted from the current Phaser implementation on 2026-08-15, before the
sim/render split. **This document is the source for the `src/sim/**` unit tests.**
Write the test from the rule stated here, watch it fail, then port the logic.

Every rule below cites the code it was read from. Where a number looks arbitrary,
it is arbitrary — it is recorded so the refactor preserves it, not because it is
principled.

> **Porting rule:** carry formulas across expression-for-expression. `0.85 + stat * 0.07`
> evaluates to `0.9199999999999999`, not `0.92`. Rewriting it as `(85 + stat * 7) / 100`
> changes the low bits, which is invisible offline and a desync online.

---

## 1. World constants

From [src/utils/constants.ts](../src/utils/constants.ts):

| Constant | Value | Note |
|---|---|---|
| `GAME_WIDTH` × `GAME_HEIGHT` | 1280 × 720 | logical resolution; all geometry is in these units |
| `GROUND_Y` | 610 | fighters' feet rest here (`origin.y = 1`) |
| `ARENA_MIN_X` / `ARENA_MAX_X` | 95 / 1185 | hard clamp on fighter `x` |
| `GRAVITY` | 1750 px/s² | |
| `JUMP_VELOCITY` | −690 px/s | ≈ 789 ms of airtime |
| `ROUND_TIME_MS` | 60 000 | → `ROUND_TICKS = 3600` at 60 Hz |
| `INPUT_BUFFER_MS` | 140 | crouch buffer for the ultimate input |
| `FIGHTER_HURTBOX_WIDTH` / `_HEIGHT` | 104 / 194 | |

Derived tables:

- `SPEED_BY_STAT` = `{1:235, 2:255, 3:280, 4:310, 5:340}` px/s
- `ATTACK_MULTIPLIER(stat)` = `0.85 + stat * 0.07`
- `RANGE_MULTIPLIER(stat)` = `0.88 + stat * 0.055` — **declared but unused**;
  [Fighter.getMeleeHitbox](../src/fighters/Fighter.ts#L203) inlines the same
  expression instead of calling it. Port the inlined one and delete the duplicate.
- `CONTROL_RECOVERY_MULTIPLIER(stat)` = `1.05 - stat * 0.025` — applied to attack
  recovery.
- Special cooldown uses a **different** control scale, inlined at
  [Fighter.ts:274](../src/fighters/Fighter.ts#L274): `1.08 - controlStat * 0.025`.
  The `1.05` vs `1.08` split is real, not a typo to normalise.

Starting positions, from [BattleScene.ts:52-53](../src/scenes/BattleScene.ts#L52-L53):
P1 at `x = 350` facing `+1`, P2 at `x = 930` facing `−1`. Both reset to these each round.

---

## 2. Input

### Today

[PlayerController](../src/controllers/PlayerController.ts) polls Phaser `Key`
objects and emits a derived `FighterIntent`:

```ts
move: left === right ? 0 : left ? -1 : 1
crouch: down.isDown
jumpPressed / lightPressed / heavyPressed: JustDown(key)
specialPressed:  JustDown(special) && !downBuffered
ultimatePressed: JustDown(special) &&  downBuffered
downBuffered = down.isDown || (now - lastDownPressedAt) <= 140
```

### Target

The network payload is the **raw button state**, one byte, and all derivation moves
into the sim so it can be re-evaluated during a resimulation:

```
bit 0 left   bit 1 right   bit 2 up   bit 3 down
bit 4 light  bit 5 heavy   bit 6 special
```

Consequences to test:

- Edges come from `current & ~prevButtons`, with `prevButtons` stored per fighter
  in `SimWorld`. `Phaser.Input.Keyboard.JustDown()` **consumes** the edge flag and
  therefore cannot be read twice for one tick.
- The 140 ms crouch buffer becomes `downBufferedUntilTick`.
- **Blocking is not a button.** It is inferred during simulation from movement
  direction versus opponent position (§5), so it cannot be resolved at sample time.
- At 144 Hz a tick spans several browser key events; the sampler must OR together
  "was down at any point since the last sample" or fast taps are lost.

---

## 3. Fighter state machine

States ([FighterState.ts](../src/fighters/FighterState.ts)): `IDLE`, `WALK`,
`CROUCH`, `JUMP`, `BLOCK`, `BLOCKSTUN`, `HITSTUN`, `LIGHT_ATTACK`, `HEAVY_ATTACK`,
`SPECIAL`, `ULTIMATE`, `KO`, `VICTORY`.

Derived predicates ([Fighter.ts:60-73](../src/fighters/Fighter.ts#L60-L73)):

- `isAirborne` ⟺ `y < GROUND_Y - 1` (note the 1 px tolerance)
- `isAttacking` ⟺ state ∈ {LIGHT_ATTACK, HEAVY_ATTACK, SPECIAL, ULTIMATE}
- `attackActive` ⟺ `startupMs ≤ elapsedMs < startupMs + activeMs`

### Per-tick order ([Fighter.update](../src/fighters/Fighter.ts#L94))

Order is load-bearing — facing is refreshed *before* the guard check, so turning
around and blocking resolve in the same tick.

1. Record `wasGrounded`.
2. **Face the opponent**: if not KO, `facing = opponent.x >= this.x ? 1 : -1`.
3. `away = opponent.x > this.x ? -1 : 1`.
4. `guardHeld = inputEnabled && intent.move === away && !intent.crouch`.
5. Exactly one branch:
   - **Attack in progress** → advance `elapsedMs`, set `activeJustStarted` on the
     tick that crosses `startupMs`, apply attack motion (§6), and when
     `elapsedMs ≥ startup + active + recovery × CONTROL_RECOVERY_MULTIPLIER` and the
     state is not KO, clear the attack and fall to `JUMP` if airborne else `IDLE`.
   - **HITSTUN / BLOCKSTUN** → decrement `stateRemainingMs`; at ≤ 0 fall to `JUMP`
     if airborne else `IDLE`.
   - **KO / VICTORY** → frozen; input ignored.
   - **`inputEnabled`** → `processIntent` (below).
   - **otherwise** → `vx = 0`; if grounded and not `CROUCH`, force `IDLE`.
6. Apply physics (§4).

### `processIntent` priority ([Fighter.ts:212](../src/fighters/Fighter.ts#L212))

**Airborne** — only two options, then early return:
1. `lightPressed` → air light; else `heavyPressed` → air heavy.
2. If no attack started: `vx = move × speed × 0.75`, state `JUMP`.

**Grounded**, first match wins:
1. **Block**: `move === away && !crouch && |opponent.x − x| < 340` → `BLOCK`, `vx = 0`.
2. **Ultimate**: `ultimatePressed` and `energy ≥ 100` and `canUseSpecial` → spend all
   100 meter, start the ultimate. If the meter is short but `canUseSpecial`, it
   **falls back to the special** rather than doing nothing.
3. `specialPressed && canUseSpecial` → special.
4. `lightPressed` → light. 5. `heavyPressed` → heavy.
6. `jumpPressed` → `vy = JUMP_VELOCITY`, `JUMP`.
7. `crouch` → `vx = 0`, `CROUCH`.
8. `move ≠ 0` → `vx = move × SPEED_BY_STAT[speedStat]`, `WALK`.
9. else → `vx = 0`, `IDLE`.

`canUseSpecial(now)` = `now ≥ nextSpecialAt` and not KO and not attacking and state
∉ {HITSTUN, BLOCKSTUN}.

---

## 4. Physics ([Fighter.applyPhysics](../src/fighters/Fighter.ts#L304))

With `dt` in seconds:

```
if (isAirborne || vy < 0):
    vy += GRAVITY * dt
    y  += vy * dt
    x  += vx * dt
    if (y >= GROUND_Y): y = GROUND_Y; vy = 0; if (state === JUMP) state = IDLE
else if (!currentAttack || kind ∉ {dash, slide}):
    x += vx * dt

if (state ∈ {HITSTUN, BLOCKSTUN, KO}): vx *= Math.pow(0.0015, dt)

x = clamp(x, ARENA_MIN_X, ARENA_MAX_X)
```

Notes:

- The `vy < 0` term is what lets the first frame of a jump lift off, before `y` has
  moved far enough for `isAirborne` to be true.
- Dash and slide attacks move via §6 instead, so horizontal velocity is skipped for
  them — otherwise the motion would apply twice.
- **`Math.pow` must not survive into `src/sim/`.** At a fixed 60 Hz the exponent is
  constant, so it becomes the literal `STUN_FRICTION_PER_TICK = 0.8972942...`
  (verify against `Math.pow(0.0015, 1/60)` in a test, then hard-code).

### Push-apart ([BattleScene.resolvePushCollision](../src/scenes/BattleScene.ts#L165))

Runs after both fighters update, skipped entirely if either is airborne:

```
dx = p2.x - p1.x
if (|dx| >= 86 || |dx| < 0.01) return
overlap = 86 - |dx| ;  dir = dx >= 0 ? 1 : -1
p1.x = clamp(p1.x - dir * overlap * 0.5)
p2.x = clamp(p2.x + dir * overlap * 0.5)
```

The `|dx| < 0.01` guard means perfectly overlapping fighters are *not* separated.

---

## 5. Blocking

`canBlockImpact` ([Fighter.ts:62](../src/fighters/Fighter.ts#L62)) — evaluated on the
**defender at the moment of impact**, not when the input was read:

```
state ∈ {BLOCK, BLOCKSTUN}  →  true
otherwise: guardHeld && !isAirborne && !isAttacking
           && state ∉ {HITSTUN, KO, VICTORY}
```

`guardHeld` is set every tick from the intent (§3 step 4) and, unlike the `BLOCK`
state, has **no 340 px range condition**. So a fighter holding away from a distant
opponent has `guardHeld === true` while its state stays `IDLE`/`WALK` — and a
projectile arriving from off-screen still gets blocked. That is existing behaviour;
preserve it.

Blocking effects: damage is scaled to `chipRatio` (§7), knockback to 24 %, no
vertical knockback, and the defender enters `BLOCKSTUN` for `blockstunMs`.

---

## 6. Attacks

`AttackSpec` ([AttackSpec.ts](../src/combat/AttackSpec.ts)) is already pure data and
ports unchanged, except that every `*Ms` field becomes ticks (`Math.round(ms * 60 / 1000)`).

Shared normals:

| | startup | active | recovery | damage | hitstun | blockstun | kbX | kbY | reach |
|---|---|---|---|---|---|---|---|---|---|
| `LIGHT_ATTACK` | 90 | 90 | 160 | 5 | 180 | 90 | 150 | −40 | 78 |
| `HEAVY_ATTACK` | 180 | 120 | 300 | 9 | 300 | 150 | 255 | −110 | 104 |

Per-fighter specials and ultimates live in
[fighterData.ts](../src/fighters/fighterData.ts) and are validated by
[fighterData.test.ts](../src/fighters/__tests__/fighterData.test.ts).

**Attack motion** while `attackActive` ([Fighter.ts:293](../src/fighters/Fighter.ts#L293)):
`dash` → `x += facing × 590 × dt`; `slide` → `x += facing × 670 × dt`;
`spec.id === 'heavy'` → `x += facing × 105 × dt`. Everything else does not move.

**Special cooldown** is armed at start, not on hit:
`nextSpecialAt = now + (cooldownMs ?? 1500) × (1.08 - controlStat × 0.025)`.

### Boxes

Hurtbox ([Fighter.ts:196](../src/fighters/Fighter.ts#L196)):
```
crouching = state === CROUCH || currentAttack?.crouching
height = crouching ? 194 × 0.66 : 194
rect(x - 52, y - height, 104, height)
```

Melee hitbox ([Fighter.ts:202](../src/fighters/Fighter.ts#L202)):
```
reach   = spec.reach × (0.88 + rangeStat × 0.055)
height  = attackCrouching ? 70 : 100
centerY = y - (attackCrouching ? 58 : attackAirborne ? 100 : 108)
originX = facing > 0 ? x + 34 : x - 34 - reach
rect(originX, centerY - height / 2, reach, height)
```

All collision is AABB (`RectangleToRectangle`). No rotation, no circles.

---

## 7. Hit resolution ([CombatSystem.resolveHit](../src/combat/CombatSystem.ts#L266))

```
if (defender.isKO) return
blocked   = defender.canBlockImpact
full      = spec.damage × ATTACK_MULTIPLIER(attacker.attackStat)
                        × (1.08 - defender.hpStat × 0.03)
damage    = blocked ? full × (spec.chipRatio ?? 0) : full
```

Then `receiveImpact` ([Fighter.ts:135](../src/fighters/Fighter.ts#L135)):

```
hp = clamp(hp - damage, 0, 100)
vx = attackerFacing × knockbackX × (blocked ? 0.24 : 1)
if (!blocked) vy = knockbackY

if (hp <= 0):                       // KO overrides everything
    state = KO ; attack = null ; stateRemaining = 0
    vx = attackerFacing × max(420, knockbackX × 1.55)
    vy = min(-260, knockbackY × 1.5)
    return

if (blocked): state = BLOCKSTUN ; stateRemaining = blockstunMs
else:         state = HITSTUN
    hitstun = spec.hitstunMs
    if (spec.kind === 'aura'):                       // diminishing stun-lock
        if (now < fullStunLockoutUntil) hitstun = min(180, hitstun)
        else fullStunLockoutUntil = now + (spec.stunLockoutMs ?? 2800)
    stateRemaining = hitstun
attack = null                       // any hit cancels the defender's own attack
```

Meter ([CombatSystem.ts:275](../src/combat/CombatSystem.ts#L275)), clamped to 0..100:

| | attacker gains | defender gains |
|---|---|---|
| clean hit | `energyOnHit` | `energyOnReceive` |
| blocked, `chipRatio > 0` | `ceil(energyOnHit × 0.35)` | `ceil(energyOnReceive × 0.35)` |
| blocked, `chipRatio === 0` | 0 | 0 |

Hit-stop (freezes the whole simulation, §9): blocked 35 ms, light 45, heavy 80,
special 95, ultimate 150, plus 120 ms once when an ultimate is first presented.

**Double-hit prevention** is a `Set<Fighter>` per attack instance / projectile /
zone. It becomes a 2-bit `hitMask` (bit 0 = P1, bit 1 = P2) — object identity does
not survive serialisation.

### Attack kinds

`melee`, `dash`, `slide`, `aura` resolve through the melee hitbox on **every active
tick** until they connect. All other kinds fire **once**, on the tick
`activeJustStarted` is true:

| kind | behaviour |
|---|---|
| `sonic`, `water`, `salad` | spawn a projectile (§8) |
| `beam` | instant rect: `width = reach`, centred `facing > 0 ? x + width/2 + 45 : x - width/2 - 45`, at `y - 122`, box `rect(cx - width/2, cy - 30, width, 60)` |
| `zone`, `ultimate-salad` | spawn a delayed ground zone (§8) |
| `ultimate-ok`, `ultimate-sonic` | wide box: `rect(x ± reach/2 - reach/2, 120, reach, GROUND_Y - 70)` |
| `ultimate-water`, `-social`, `-freeze`, `-alien`, `-magic` | **unconditional hit**, no geometry test |

---

## 8. Projectiles and zones

**Projectiles** ([CombatSystem.ts:134](../src/combat/CombatSystem.ts#L134)):

```
spawn at (owner.x + facing × 70, owner.y - 118)
vx   = facing × (projectileSpeed ?? 600)
life = lifetimeMs ?? 900
size = water ? 118×34 : salad ? 76×54 : 90×46
```
Per tick: `life -= dt`, `x += vx × dt`, then AABB against the target's hurtbox —
skipped if already hit or the target is KO. Despawns on hit, on `life ≤ 0`, or once
`x < -100` or `x > GAME_WIDTH + 100`.

**Zones** ([CombatSystem.ts:171](../src/combat/CombatSystem.ts#L171)) are placed
relative to the *defender*, which makes them the only attack whose spawn position
depends on the opponent:

| | `zone` | `ultimate-salad` |
|---|---|---|
| x | `clamp(defender.x + defender.vx × 0.15, 120, 1160)` | `clamp(defender.x, 130, 1150)` |
| telegraph | `telegraphMs ?? 450` | `telegraphMs ?? 500` |
| active | `spec.activeMs` | **220, hard-coded** |
| hit radius | `\|target.x − zone.x\| < 100` | `< 150` |

After the telegraph expires the zone becomes active; a target is hit if it is inside
the radius **and** `hurtbox.bottom > GROUND_Y - 250` (i.e. not jumping over it).

---

## 9. Round and match flow ([BattleScene](../src/scenes/BattleScene.ts))

Phases: `intro` → `fight` → `ending`.

- `beginRound`: reset both fighters and the combat system, `roundTimeMs = 60 000`,
  `hitStopMs = 0`. Announcements at +0 ms ("ROUND n") and +620 ms ("CAT FIGHT!");
  `phase = 'fight'` at **+1120 ms**.
- During `fight`: controllers produce intents, both fighters update, push-apart runs,
  combat resolves, `roundTimeMs -= dt`.
- **Hit-stop**: while `hitStopMs > 0`, the entire simulation is skipped for that tick
  and only `hitStopMs -= dt` happens. This must live in `SimWorld`, not the scene.
- Round end:
  - KO — `p1.hp ≤ 0 || p2.hp ≤ 0`; winner is `0` if both are down, else whoever is up.
  - Time — `diff = p1.hp − p2.hp`; `|diff| < 0.01` is a draw, else higher HP wins.
  - The winner plays `VICTORY`; on a **time-out** the loser is forced to `KO`.
  - After 2350 ms: match over at 2 round wins → `ResultScene`, else next round.

Everything above currently runs on `scene.time.delayedCall`, guarded by a
`roundToken` counter. In the sim these become `phase` + `phaseTicks` counters, and
the 620/1120/2350 ms delays become 37/67/141 ticks.

---

## 10. Determinism hazards

Checklist for the port. Each line is a test in `src/sim/__tests__/`.

| # | Hazard | Where | Resolution |
|---|---|---|---|
| 1 | Variable timestep `min(delta, 34)` | [BattleScene.ts:73](../src/scenes/BattleScene.ts#L73) | fixed 60 Hz accumulator |
| 2 | Wall-clock `nowMs` in cooldowns / stun lockout / input buffer | Fighter, PlayerController | tick counters |
| 3 | `Math.pow(0.0015, dt)` | [Fighter.ts:319](../src/fighters/Fighter.ts#L319) | hard-coded per-tick constant |
| 4 | Phaser objects inside sim records (`display`, `sprite`) | CombatSystem, Fighter | render layer keyed by entity id |
| 5 | `Set<Fighter>` / `owner: Fighter` | CombatSystem, Fighter | `hitMask` bits, `ownerIndex` |
| 6 | `JustDown()` consumes the edge | PlayerController | raw button mask + `prevButtons` |
| 7 | `delayedCall` round flow | BattleScene | `phase` + `phaseTicks` |
| 8 | `Math.random` in CPU AI (7 sites) | [CPUController.ts](../src/controllers/CPUController.ts) | seeded xorshift32 in `SimWorld` |
| 9 | `Math.random` in stage / CPU character pick | GameState, CharacterSelectScene | host-chosen seed |
| 10 | module-level `globalAttackId` | [Fighter.ts:22](../src/fighters/Fighter.ts#L22) | `world.nextEntityId` |

`Math.random` in [VFXManager](../src/systems/VFXManager.ts),
[StageRenderer](../src/stages/StageRenderer.ts) and [AudioManager](../src/systems/AudioManager.ts)
is **fine and must stay** — those are presentation-only and never feed back into state.

`Date.now()`, `performance.now()` and `new Date()` do not appear in `src/` at all;
wall-clock time enters only through Phaser's `time` argument.
