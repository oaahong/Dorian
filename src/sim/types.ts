import type { AttackKind } from '../combat/AttackSpec';
import type { FighterState } from '../fighters/FighterState';

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
  /** Whether the attack was started from a crouch — changes its boxes. */
  crouching: boolean;
  /** Whether the attack was started in the air. */
  airborne: boolean;
  /** Targets already hit by this instance, as HIT_P1 | HIT_P2. */
  hitMask: number;
}

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
  /** Previous tick's raw button mask, for rising-edge detection. */
  prevButtons: number;
  /** Absolute tick until which a crouch press still counts toward the ultimate. */
  downBufferedUntilTick: number;
}
