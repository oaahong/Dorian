import type { AttackKind } from '../combat/AttackSpec';
import type { FighterState } from '../fighters/FighterState';
import type { CommandHistory } from './command';

/**
 * Simulation state. Plain data only — no class instances, no object references
 * between entities, nothing from Phaser. Everything here must survive a
 * structured clone so a world can be snapshotted, hashed and (later) rolled back.
 *
 * See docs/sim-spec.md.
 */

/** Bit positions used by `hitMask`, so an attack can only land once per target. */
export const HIT_P1 = 1 << 0;
export const HIT_P2 = 1 << 1;

/** Index of a fighter within `SimWorld.fighters`. */
export type PlayerIndex = 0 | 1;

/**
 * Something the simulation did that the presentation layer may want to react to.
 *
 * The simulation never calls AudioManager or VFXManager directly — it appends to
 * an event list, and the render layer drains it each frame. That keeps sound and
 * particles out of the deterministic path (so they can stay random) and makes the
 * behaviour assertable in a headless test.
 */
export type SimEvent =
  | { t: 'jump'; player: PlayerIndex }
  | { t: 'attackStart'; player: PlayerIndex; specId: string; state: FighterState }
  | { t: 'roundStart'; round: number }
  | { t: 'announce'; text: string }
  | { t: 'roundEnd'; winner: RoundWinner; reason: 'KO' | 'TIME' }
  | { t: 'matchEnd'; winner: PlayerIndex }
  | { t: 'ultimateStart'; player: PlayerIndex; specId: string }
  | { t: 'projectileSpawn'; id: number; player: PlayerIndex; specId: string; x: number; y: number }
  | { t: 'projectileEnd'; id: number }
  | { t: 'zoneSpawn'; id: number; player: PlayerIndex; specId: string; x: number }
  | { t: 'zoneTrigger'; id: number }
  | { t: 'zoneEnd'; id: number }
  | { t: 'beam'; player: PlayerIndex; specId: string; x: number; y: number; width: number }
  | {
      t: 'hit';
      /** The attacker. */
      player: PlayerIndex;
      specId: string;
      impact: ImpactWeight;
      blocked: boolean;
      /** Where the original drew its spark. */
      x: number;
      y: number;
    };

/** How heavy a connected hit felt — drives spark size, sound and hit-stop. */
export type ImpactWeight = 'light' | 'heavy' | 'special' | 'ultimate';

/** Axis-aligned box in logical 1280x720 space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 0 means a draw; otherwise the one-based player number, matching the original. */
export type RoundWinner = 0 | 1 | 2;

export type RoundPhase = 'intro' | 'fight' | 'ending';

export interface SimProjectile {
  id: number;
  ownerIndex: PlayerIndex;
  specId: string;
  x: number;
  y: number;
  vx: number;
  width: number;
  height: number;
  lifeTicks: number;
  hitMask: number;
}

export interface SimZone {
  id: number;
  ownerIndex: PlayerIndex;
  specId: string;
  x: number;
  /** Telegraph countdown; the zone is harmless until it reaches zero. */
  timerTicks: number;
  activeTicks: number;
  triggered: boolean;
  hitMask: number;
}

/**
 * The complete simulation state.
 *
 * Everything a match needs to advance lives here — including the round phase
 * timers that used to be Phaser `delayedCall`s and the hit-stop that used to be a
 * scene field. If it is not in this object, it cannot be snapshotted, hashed or
 * rolled back, and two clients will eventually disagree about it.
 */
export interface SimWorld {
  tick: number;
  phase: RoundPhase;
  /** Ticks elapsed inside the current phase. Replaces the scene's delayed calls. */
  phaseTicks: number;
  roundNumber: number;
  roundTicksRemaining: number;
  /** While positive the whole simulation is frozen, including the round clock. */
  hitStopTicks: number;
  fighters: [SimFighter, SimFighter];
  projectiles: SimProjectile[];
  zones: SimZone[];
  nextEntityId: number;
  roundWins: [number, number];
  matchWinner: PlayerIndex | null;
  stage: string;
  rng: { state: number };
}

export interface SimAttack {
  /** Identifies the AttackSpec this instance came from. */
  specId: string;
  /**
   * Copied from the spec at creation time. Denormalised so the physics and
   * motion steps stay self-contained rather than reaching into a spec registry
   * every tick; the spec is immutable, so this cannot drift.
   */
  kind: AttackKind;
  elapsedTicks: number;
  /**
   * True only on the tick the active window opens. Recomputed every tick from
   * `elapsedTicks`, so it is derived rather than free-running state — the
   * one-shot attack kinds (projectiles, zones, beams) fire off it.
   */
  activeJustStarted: boolean;
  /** Whether the attack was started from a crouch — changes its boxes. */
  crouching: boolean;
  /** Whether the attack was started in the air. */
  airborne: boolean;
  /** Targets already hit by this instance, as HIT_P1 | HIT_P2. */
  hitMask: number;
  /** Whether the ultimate's one-off presentation has already fired. */
  presented: boolean;
  /**
   * How many of the spec's `hits` have landed. Indexes the damage list, and once
   * it reaches the end the attack can no longer connect.
   */
  hitsUsed: number;
  /** Absolute tick from which a multi-hit attack may connect again. */
  rehitReadyTick: number;
  /** How many hits this instance's armour window has already absorbed. */
  armorUsed: number;
  /**
   * Whether this attack has connected, and how.
   *
   * On the attack rather than on the fighter, so it is cleared by the act of
   * starting the next move and cannot outlive the one it describes. Cancels read
   * it: a cancel is permitted only by a move that actually touched someone, which
   * is what stops mashing into thin air from being free.
   */
  result: MoveResult;
}

/** Whether an attack has connected yet, and how. */
export type MoveResult = 'none' | 'hit' | 'block';

export interface SimFighter {
  /** Looks up the immutable FighterConfig; never holds the config object itself. */
  configId: string;
  state: FighterState;
  hp: number;
  energy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  /** Remaining hitstun / blockstun. */
  stateRemainingTicks: number;
  attack: SimAttack | null;
  /** Absolute tick at which the special comes off cooldown. */
  nextSpecialTick: number;
  /** Absolute tick until which `aura` attacks only apply reduced stun. */
  stunLockoutUntilTick: number;
  /** Holding away from the opponent — recomputed every tick from the input. */
  guardHeld: boolean;
  /**
   * Guarding while also holding down — the low guard.
   *
   * Separate from `guardHeld` rather than inferred from `FighterState.CROUCH`,
   * because a crouch-blocking fighter is in `BLOCK`, not `CROUCH`, and because it
   * has to stay readable through `BLOCKSTUN` — that is exactly when a defender is
   * deciding whether the next hit of the string is high or low.
   */
  guardCrouching: boolean;
  /** Previous tick's raw button mask, for rising-edge detection. */
  prevButtons: number;
  /**
   * The last COMMAND_HISTORY_TICKS of raw input, for motion recognition.
   *
   * In the world rather than in a controller because lockstep only ships raw
   * input: anything derived has to be recomputed identically on both machines,
   * and anything remembered has to be restorable by a rollback.
   */
  commandHistory: CommandHistory;
  /** Absolute tick until which a crouch press still counts toward the ultimate. */
  downBufferedUntilTick: number;
  /**
   * Ticks left in a dash. Zero means the fighter is not dashing.
   *
   * A dash is committed movement, not an attack: it holds no `SimAttack`, so this
   * counter is the only thing keeping it alive. Being hit ends it because hitstun
   * replaces the state, which is the behaviour a dash should have anyway.
   */
  dashTicks: number;
  /** Absolute tick at which the parry comes off its cooldown. */
  nextParryTick: number;
  /**
   * Ticks the bare special button has been held while winding up.
   *
   * Only meaningful while `state` is `H_CHARGING`; the state is the discriminator,
   * so there is no separate "is charging" flag to keep in step with it.
   */
  chargeTicks: number;
  /**
   * Ticks remaining on the install buff: harder hits and a bigger body.
   *
   * Counted down in the fighter step rather than compared against an absolute
   * expiry tick, so it survives being snapshotted into a world whose tick differs.
   */
  installTicks: number;
  /** Ticks remaining on the movement slow a sticky or awkward hit leaves behind. */
  slowTicks: number;
}
