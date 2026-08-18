# Simulation Spec

What the simulation does, and why each rule is the way it is.

Originally written by reading the pre-refactor Phaser implementation, as the
source for the tests that would replace it. The port is done, so this is now the
reference for `src/sim` — but the framing has been kept: where a number looks
arbitrary, it *is* arbitrary, recorded so that a change to it is a decision rather
than an accident.

Every rule cites the code it lives in. Where a rule is easy to mistake for a bug,
that is called out, because several of them are.

> **Determinism rule:** carry formulas expression-for-expression. `0.85 + stat * 0.07`
> evaluates to `0.9199999999999999`, not `0.92`. Rewriting it as `(85 + stat * 7) / 100`
> changes the low bits — invisible offline, a desync online.

---

## 1. World constants

From [src/sim/constants.ts](../src/sim/constants.ts). `src/utils/constants.ts`
re-exports these for the Phaser code and keeps only colours and fonts of its own.

| Constant | Value | Note |
|---|---|---|
| `TICK_HZ` / `DT` | 60 / `1/60` | `DT` is a **constant**, never a measured frame delta |
| `GAME_WIDTH` × `GAME_HEIGHT` | 1280 × 720 | all geometry is in these units |
| `GROUND_Y` | 610 | fighters' feet rest here |
| `ARENA_MIN_X` / `ARENA_MAX_X` | 95 / 1185 | hard clamp on fighter `x` |
| `GRAVITY` | 1750 px/s² | |
| `JUMP_VELOCITY` | −690 px/s | ≈ 47 ticks of airtime |
| `ROUND_TICKS` | 3600 | 60 seconds |
| `INPUT_BUFFER_TICKS` | 8 | crouch buffer, so a motion ending in down still reads as crouching |
| `FIGHTER_HURTBOX_WIDTH` / `_HEIGHT` | 104 / 194 | |
| `INSTALL_BODY_SCALE` | 2 | a transformed fighter's body, and its hurtbox |
| `PUSH_APART_DISTANCE` | 86 | minimum separation between grounded fighters |
| `P1_SPAWN_X` / `P2_SPAWN_X` | 350 / 930 | facing `+1` and `−1`, reset each round |

Derived tables:

- `SPEED_BY_STAT` = `{1:235, 2:255, 3:280, 4:310, 5:340}` px/s
- `ATTACK_MULTIPLIER(stat)` = `0.85 + stat * 0.07`
- `RANGE_MULTIPLIER(stat)` = `0.88 + stat * 0.055`
- `CONTROL_RECOVERY_MULTIPLIER(stat)` = `1.05 - stat * 0.025` — attack recovery
- `CONTROL_COOLDOWN_MULTIPLIER(stat)` = `1.08 - stat * 0.025` — special cooldown
- `HP_STAT_MITIGATION(stat)` = `1.08 - stat * 0.03`

**The `1.05` / `1.08` split is real.** Two different control curves, one for
recovery and one for cooldown, inherited from the original and preserved
deliberately. It is not a typo to normalise away.

**`STUN_FRICTION_PER_TICK` is a literal, not a computation.** The original was
`vx *= Math.pow(0.0015, dt)`. `Math.pow` is not required to be bit-identical
across JavaScript engines, so it cannot run inside the simulation; with a fixed
timestep the exponent is constant, and the whole call collapses to
`0.89729418715708964`. `constants.test.ts` is the only place that literal and
`Math.pow` are allowed to meet.

---

## 2. Input

The network payload is **one 16-bit word of raw button state** per player per tick
([src/sim/input.ts](../src/sim/input.ts)):

```
bit 0 left   bit 1 right   bit 2 up      bit 3 down
bit 4 light  bit 5 heavy   bit 6 special bit 7 throw   bit 8 ultimate
```

It was one byte with a bit spare until the upgraded build's control scheme
arrived, needing a throw and a dedicated ultimate button — nine bits, which do not
fit in eight. Packing the directions into a 4-bit numpad value would have bought
the bit back, at the cost of making `moveAxis` and the block check decode a field
rather than test a bit, on the hot path, to save one byte per tick.

Nothing derived travels: press edges, blocking, and which motion was spelled are
all recomputed inside the simulation, so a resimulation of the same bytes reaches
the same decisions.

- **Edges** come from `current & ~prevButtons`, with `prevButtons` stored per
  fighter in `SimWorld`. Phaser's `JustDown()` *consumes* the flag and can only be
  read once per tick, which is fatal to any replay.
- **The 140 ms crouch buffer** is `downBufferedUntilTick`. It exists so a motion
  ending in a down still reads as crouching a few ticks later; it no longer
  arbitrates between a special and an ultimate — see below.
- **The bare special button charges.** Pressing it with no motion behind it enters
  `H_CHARGING` and counts `chargeTicks`; releasing fires
  `chargeSpecials.ts`'s level 1, 2 or 3 at 0 / 24 / 54 ticks. The level is derived
  from the counter rather than stored beside it, so there is one number to
  snapshot. A charge never fires on its own — the counter saturates at level 3
  rather than free-running, which also keeps the checksum stable on a fighter who
  never lets go. Charging blocks walking, jumping, attacking **and guarding**, so
  any hit that arrives lands; the cancel needs no code, since `H_CHARGING` is the
  only thing keeping a charge alive and hitstun replaces it.
- **The ultimate has one input: its own button.** There used to be a second,
  `down + special`, kept from before that button existed, and it needed a
  precedence rule to be usable at all: every quarter-circle passes through a down
  two or three ticks before the button, well inside the crouch buffer, so a 236 on
  a full meter fired the ultimate instead of the fireball. The rule went unnoticed
  as a bug while the motion tests ran on an empty meter, where the ultimate fell
  through to the motion anyway. Removing the input removed the rule: a crouching
  player reaches their charge special, and the special button is unconditionally
  the special button.
- **Motion inputs** (236, 214, 623, double taps) are read from
  `commandHistory`, a fixed 30-tick ring of raw input words held per fighter in
  `SimWorld` and folded into the checksum
  ([src/sim/command.ts](../src/sim/command.ts)). The upgraded build parsed these
  in its controller, from a buffer holding `Set`s of pressed keys; state outside
  the world is state the opponent never receives and a rollback never restores, so
  the two clients would disagree about whether a fireball came out. Recording is
  the only mutation — every query is a pure read, so it can be asked repeatedly
  within a tick.
- **Directions are facing-relative** (numpad notation), so one authored motion
  works from both sides of the screen. Opposing directions cancel to neutral, as
  keyboards report both during rollover.
- **`22` is a genuine double tap** — press, release, press — rather than the
  subsequence match the upgraded build used, which was satisfied by merely
  *holding* down and so could not be told apart from crouching. It also swallowed
  slowly-rolled 236 inputs, since those pass through two frames of down and `22`
  was checked first.
- **Blocking is not a button.** It is inferred from movement direction versus
  opponent position (§5), so it can only be resolved during simulation.
- **Sampling** happens in [KeyboardSampler](../src/render/KeyboardSampler.ts),
  once per tick, latching every keydown until the next read. At 144 Hz a tick
  spans several browser key events, and a tap that begins and ends between two
  samples would otherwise be lost.
- **A frame, once offered for a tick, is final.** Re-sampling a tick that has
  already been transmitted diverges the two clients, because the opponent keeps
  the first value it received. See §11.

---

## 3. Fighter state machine

States ([FighterState.ts](../src/fighters/FighterState.ts)): `IDLE`, `WALK`,
`CROUCH`, `JUMP`, `BLOCK`, `BLOCKSTUN`, `HITSTUN`, `LIGHT_ATTACK`, `HEAVY_ATTACK`,
`SPECIAL`, `ULTIMATE`, `KO`, `VICTORY`.

Predicates ([src/sim/fighter.ts](../src/sim/fighter.ts)):

- `isAirborne` ⟺ `y < GROUND_Y - 1`. The one-pixel tolerance stops a fighter
  flickering between grounded and airborne on the frame it lands.
- `isAttacking` ⟺ state ∈ {LIGHT_ATTACK, HEAVY_ATTACK, SPECIAL, ULTIMATE}
- `attackActive` ⟺ `startupTicks ≤ elapsedTicks < startupTicks + activeTicks`

### Per-tick order (`stepFighter`)

Load-bearing: facing is refreshed *before* the guard check, so turning around and
blocking resolve on the same tick.

1. **Face the opponent**: if not KO, `facing = opponent.x >= x ? 1 : -1`.
2. `away = opponent.x > x ? -1 : 1`.
3. `guardHeld = inputEnabled && move === away && !crouch`.
4. Exactly one branch:
   - **Attack in progress** → advance `elapsedTicks`, set `activeJustStarted` on
     the tick that crosses startup, apply attack motion (§6), and when
     `elapsed ≥ startup + active + recovery × CONTROL_RECOVERY_MULTIPLIER` and the
     state is not KO, clear it and fall to `JUMP` if airborne else `IDLE`.
   - **HITSTUN / BLOCKSTUN** → decrement; at zero fall to `JUMP` or `IDLE`.
   - **KO / VICTORY** → frozen.
   - **`inputEnabled`** → `processIntent`.
   - **otherwise** → `vx = 0`; if grounded and not `CROUCH`, force `IDLE`.
5. Apply physics (§4).

Buttons held through the round intro register as a fresh press on the first tick
of the fight. That reproduces the original, where the scene simply did not poll
its controllers outside the fight phase.

### `processIntent` priority

**Airborne** — two options, then return:
1. `lightPressed` → air light; else `heavyPressed` → air heavy.
2. If no attack started: `vx = move × speed × 0.75`, state `JUMP`.

**Grounded**, first match wins:
1. **Block**: `move === away && !crouch && |opponent.x − x| < 340` → `BLOCK`, `vx = 0`.
2. **Ultimate**: `ultimatePressed` and `energy ≥ 100` and `canUseSpecial` → spend
   the whole meter. **A short meter does nothing.** There is no fallback to a
   special: holding this button is how the meter is filled, so a fallback would
   mean that reaching for the charge threw a fireball.
3. `specialPressed && canUseSpecial` → special.
4. `lightPressed` → light. 5. `heavyPressed` → heavy.
6. `jumpPressed` → `vy = JUMP_VELOCITY`, `JUMP`.
7. `crouch` → `vx = 0`, `CROUCH`.
8. `move ≠ 0` → `vx = move × SPEED_BY_STAT[speedStat]`, `WALK`.
9. else → `vx = 0`, `IDLE`.

`canUseSpecial(tick)` = off cooldown, not KO, not attacking, state ∉ {HITSTUN, BLOCKSTUN}.

---

## 4. Physics (`stepPhysics`)

```
if (isAirborne || vy < 0):
    vy += GRAVITY * DT
    y  += vy * DT
    x  += vx * DT
    if (y >= GROUND_Y): y = GROUND_Y; vy = 0; if (state === JUMP) state = IDLE
else if (kind ∉ {dash, slide}):
    x += vx * DT

if (state ∈ {HITSTUN, BLOCKSTUN, KO}): vx *= STUN_FRICTION_PER_TICK

x = clamp(x, ARENA_MIN_X, ARENA_MAX_X)
```

- The `vy < 0` term is what lets the first tick of a jump lift off, before `y` has
  moved far enough for `isAirborne` to be true.
- Dash and slide drive themselves through attack motion, so `vx` is skipped for
  them — otherwise they would move at double speed.

### Push-apart ([src/sim/world.ts](../src/sim/world.ts))

Runs after both fighters update, skipped entirely if either is airborne:

```
dx = p2.x - p1.x
if (|dx| >= 86 || |dx| < 0.01) return
overlap = 86 - |dx| ;  dir = dx >= 0 ? 1 : -1
p1.x = clamp(p1.x - dir * overlap * 0.5)
p2.x = clamp(p2.x + dir * overlap * 0.5)
```

The `|dx| < 0.01` guard means perfectly overlapping fighters are *not* separated —
there is no direction to separate them in.

---

## 5. Blocking

`canBlockImpact` ([src/sim/combat.ts](../src/sim/combat.ts)) is evaluated on the
**defender at the moment of impact**, not when the input was read:

```
state ∈ {BLOCK, BLOCKSTUN}  →  true
otherwise: guardHeld && !isAirborne && !isAttacking
           && state ∉ {HITSTUN, KO, VICTORY}
```

**`guardHeld` has no range condition; only the BLOCK *stance* does.** A fighter
holding away from a distant opponent has `guardHeld === true` while its state
stays `IDLE`/`WALK` — so a projectile arriving from off-screen still gets blocked.
Preserved from the original.

Blocked: damage scaled to `chipRatio`, knockback to 24%, no vertical knockback,
`BLOCKSTUN` for `blockstunTicks`.

---

## 6. Attacks

`AttackSpec` ([AttackSpec.ts](../src/combat/AttackSpec.ts)) is authored **in
ticks**. [attackSpecs.ts](../src/sim/attackSpecs.ts) no longer converts anything;
what it still does at module load is resolve the `?? 1500` / `?? 2800` / `?? 900`
fallbacks that used to be scattered through the combat code, which is why every
`TickSpec` field is required where its `AttackSpec` counterpart is optional.

It was authored in milliseconds until the upgraded build was merged. Two units for
one quantity meant the numbers a designer typed were never the numbers the game
ran — `startupMs: 90` became 5 ticks, or 83.3 ms, and nothing you could type in the
90 would express 5.5 — and every edit re-opened the question of whether some window
had rounded to zero and quietly stopped connecting. The current values are the old
rounding applied once and kept, so the change was unit-only: the golden replays are
byte-identical across it.

Shared normals, in ticks:

| | startup | active | recovery | damage | hitstun | blockstun | kbX | kbY | reach |
|---|---|---|---|---|---|---|---|---|---|
| `LIGHT_ATTACK` | 5 | 5 | 10 | 5 | 11 | 5 | 150 | −40 | 78 |
| `HEAVY_ATTACK` | 11 | 7 | 18 | 9 | 18 | 9 | 255 | −110 | 104 |

Per-fighter specials and ultimates live in
[fighterData.ts](../src/fighters/fighterData.ts) and are shape-checked by
[fighterData.test.ts](../src/fighters/__tests__/fighterData.test.ts).

**Attack motion** while `attackActive`: `dash` → `x += facing × 590 × DT`;
`slide` → `× 670`; the shared heavy → `× 105`. Everything else does not move.

**Special cooldown** is armed at start, not on hit:
`nextSpecialTick = tick + cooldownTicks × CONTROL_COOLDOWN_MULTIPLIER(controlStat)`.

### Boxes

Hurtbox:
```
crouching = state === CROUCH || guardCrouching || attack?.crouching
scale     = installTicks > 0 ? 2 : 1
height    = (crouching ? 194 × 0.66 : 194) × scale
width     = 104 × scale
rect(x - width / 2, y - height, width, height)
```

**An install doubles the body, and the box follows it.** The four transformation
ultimates make their owner physically twice the size for 480 ticks, growing upward
and outward from the centre so the feet stay on the floor. That is the trade the
transformation makes rather than a side effect of the art: hitting harder while
being easier to hit. It is multiplication and not rounding — `194 × 0.66` is
already a non-integer, both clients evaluate the same IEEE-754 operations in the
same order, and a `Math.round` added for the look of it would change the boxes and
need every golden replay rerecorded to say so.

Melee hitbox:
```
reach   = spec.reach × RANGE_MULTIPLIER(rangeStat)
height  = attackCrouching ? 70 : 100
centerY = y - (attackCrouching ? 58 : attackAirborne ? 100 : 108)
originX = facing > 0 ? x + 34 : x - 34 - reach
```

All collision is AABB. Touching edges do not count as contact.

**Crouching is not an evasion.** The standing melee box spans roughly 58..158
above the feet and a crouched hurtbox still reaches 128, so they overlap.
Crouching only shrinks the target. Jumping does clear it.

---

## 7. Hit resolution (`resolveHit`)

```
if (defender.isKO) return null
blocked   = canBlockImpact(defender)
full      = spec.damage × ATTACK_MULTIPLIER(attacker.attackStat)
                        × HP_STAT_MITIGATION(defender.hpStat)
damage    = blocked ? full × spec.chipRatio : full
```

Then `receiveImpact`:

```
hp = clamp(hp - damage, 0, 100)
vx = attackerFacing × knockbackX × (blocked ? 0.24 : 1)
if (!blocked) vy = knockbackY

if (hp <= 0):                       // KO overrides everything
    state = KO ; attack = null ; stateRemainingTicks = 0
    vx = attackerFacing × max(420, knockbackX × 1.55)
    vy = min(-260, knockbackY × 1.5)
    return

if (blocked): state = BLOCKSTUN ; stateRemainingTicks = blockstunTicks
else:         state = HITSTUN
    hitstun = spec.hitstunTicks
    if (spec.kind === 'aura'):                       // diminishing stun-lock
        if (tick < stunLockoutUntilTick) hitstun = min(11 ticks, hitstun)
        else stunLockoutUntilTick = tick + spec.stunLockoutTicks
attack = null                       // any hit cancels the defender's own attack
```

The aura lock-out caps a repeat hit and **does not extend the window**. That is
what stops the move looping into an infinite stun.

Meter, clamped to 0..100:

| | attacker gains | defender gains |
|---|---|---|
| clean hit | `energyOnHit` | `energyOnReceive` |
| blocked, `chipRatio > 0` | `ceil(energyOnHit × 0.35)` | `ceil(energyOnReceive × 0.35)` |
| blocked, `chipRatio === 0` | 0 | 0 |

Hit-stop freezes the whole simulation: blocked 2 ticks, light 3, heavy 5, special
6, ultimate 9, plus 7 once when an ultimate is first presented.

Double-hit prevention is a two-bit `hitMask` per attack instance, projectile and
zone. Object identity does not survive serialisation.

### Attack kinds

`melee`, `dash`, `slide`, `aura` test the melee hitbox on **every active tick**.
All other kinds fire **once**, on `activeJustStarted`:

| kind | behaviour |
|---|---|
| `sonic`, `water`, `salad` | spawn a projectile (§8) |
| `beam` | instant rect: `width = reach`, offset 45 px in front, at `y - 122`, 60 px tall |
| `zone`, `ultimate-salad` | spawn a delayed ground zone (§8) |
| `ultimate-ok`, `ultimate-sonic` | wide box: `reach` wide, from `y = 120` down to `GROUND_Y - 70` |
| `ultimate-water`, `-social`, `-freeze`, `-alien`, `-magic` | **unconditional hit**, no geometry |

---

## 8. Projectiles and zones

**Projectiles**: spawn at `(owner.x + facing × 70, owner.y - 118)`, `vx = facing ×
projectileSpeed`, sized `118×34` for water, `76×54` for salad, `90×46` otherwise.
Per tick: age, move, then AABB against the target's hurtbox — skipped if already
hit or the target is KO. Despawn on hit, on expiry, or once `x` is 100 px outside
the screen.

**Zones** are placed relative to the *defender*, the only attack whose spawn
position depends on the opponent:

| | `zone` | `ultimate-salad` |
|---|---|---|
| x | `clamp(defender.x + defender.vx × 0.15, 120, 1160)` | `clamp(defender.x, 130, 1150)` |
| telegraph | `telegraph ?? 27t` | `30t` as authored |
| active | `spec.activeTicks` | **13 ticks, hard-coded** |
| hit radius | `< 100` | `< 150` |

After the telegraph a target is hit if it is inside the radius **and**
`hurtbox.bottom > GROUND_Y - 250` — jumping clears it.

---

## 9. Round and match flow ([src/sim/world.ts](../src/sim/world.ts))

Phases: `intro` → `fight` → `ending`, driven by `phase` and `phaseTicks` in the
world. These were `scene.time.delayedCall` timers, which drift between two clients
and cannot be replayed.

- **Intro**: "ROUND n" at tick 0, "CAT FIGHT!" at 37, control at 67.
- **Fight**: controllers produce inputs, both fighters update, push-apart runs,
  combat resolves, `roundTicksRemaining` decrements.
- **Hit-stop**: while positive, the entire simulation is skipped for that tick and
  only the counter moves. It lives in the world, not the scene, so it snapshots.
- **Round end**:
  - KO — winner is `0` if both are down, else whoever is up. The loser's KO state
    comes from `receiveImpact`; `endRound` deliberately does not re-apply it.
  - Time — `|p1.hp − p2.hp| < 0.01` is a draw, else higher HP wins. On a time-out
    the loser is *posed* as KO'd, since nobody actually fell over.
  - After 141 ticks: two round wins ends the match, otherwise the next round.

---

## 10. Determinism rules

All resolved, and all enforced by
[purity.test.ts](../src/sim/__tests__/purity.test.ts) — which fails the build
rather than waiting for two players to disagree.

| Rule | Why |
|---|---|
| Fixed 60 Hz timestep, `DT` constant | a measured frame delta makes 60 Hz and 144 Hz clients compute different positions |
| Tick counts, never wall-clock time | a clock drifts between machines and cannot be rewound |
| No `Math.pow`/`sin`/`cos`/`exp` or `**` | not required to be bit-identical across engines |
| No Phaser import, no DOM | the simulation must run headless, on a server or in a test |
| No object references between entities | `hitMask` bits and `ownerIndex`, so state survives serialisation |
| No `Math.random` | `rng.ts`, seeded by the host, with its state inside `SimWorld` |
| No module-level mutable state | `world.nextEntityId`, so two worlds cannot interfere |

Only `+ - * /` and `Math.min/max/abs/floor/ceil/round/trunc/sign/sqrt` are
allowed — the operations IEEE 754 requires to be exactly rounded.

`Math.random` in [VFXManager](../src/systems/VFXManager.ts),
[StageRenderer](../src/stages/StageRenderer.ts) and
[AudioManager](../src/systems/AudioManager.ts) is **fine and must stay**. Those are
presentation-only and never feed back into state — which is the entire point of
the split.

---

## 11. Rules the network layer depends on

These are not simulation rules, but breaking them breaks the simulation's promise.
Each was learned from a bug that only appeared between two real machines.

- **Both clients must use the same input delay.** It decides how many opening
  ticks run on primed neutral input. Different values leave each side waiting for
  a frame the other was never going to send — a permanent stall a few ticks in,
  indistinguishable from a dead connection. Agreed in the lobby, not computed
  per machine.
- **Both clients must use the same transport.** One sending over the data channel
  while the other listens on the socket looks exactly the same way.
- **A transmitted input frame is final.** The opponent keeps the first value it
  receives for a tick, so changing our mind afterwards means the two simulate that
  tick from different inputs. Reachable from ordinary play: a stalled client keeps
  being asked for its buttons, and a player pressing keys gives a different answer
  each time.
- **The redundancy window must exceed the input delay, with margin.** A client may
  legitimately sit a full delay behind, so a window only that wide is already
  sliding past the frames it still needs — and the channel is unreliable, so one
  drop becomes permanent.
- **A stall is not a debt to repay.** Both clients are gated on the same inputs, so
  neither is ever ahead; carrying the waiting time forward leaves the match
  permanently behind real time.
