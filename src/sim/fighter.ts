import { FighterState } from '../fighters/FighterState';
import {
  ARENA_MAX_X,
  ARENA_MIN_X,
  DT,
  GRAVITY,
  GROUND_Y,
  MAX_HP,
  STUN_FRICTION_PER_TICK,
} from './constants';
import type { SimFighter } from './types';

/**
 * Per-fighter simulation. Ported from `src/fighters/Fighter.ts` with the Phaser
 * sprite, tweens and audio calls stripped out — see docs/sim-spec.md §3-4.
 *
 * Functions mutate the fighter in place rather than returning a new object: this
 * runs 60 times a second and, once rollback lands, several times per frame.
 */

export function createFighter(configId: string, x: number, facing: 1 | -1): SimFighter {
  return {
    configId,
    state: FighterState.IDLE,
    hp: MAX_HP,
    energy: 0,
    x,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    facing,
    stateRemainingTicks: 0,
    attack: null,
    nextSpecialTick: 0,
    stunLockoutUntilTick: 0,
    guardHeld: false,
    prevButtons: 0,
    downBufferedUntilTick: 0,
  };
}

/** Return a fighter to its round-start state, in place. */
export function resetFighter(fighter: SimFighter, x: number, facing: 1 | -1): void {
  fighter.state = FighterState.IDLE;
  fighter.hp = MAX_HP;
  fighter.energy = 0;
  fighter.x = x;
  fighter.y = GROUND_Y;
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.facing = facing;
  fighter.stateRemainingTicks = 0;
  fighter.attack = null;
  fighter.nextSpecialTick = 0;
  fighter.stunLockoutUntilTick = 0;
  fighter.guardHeld = false;
  fighter.prevButtons = 0;
  fighter.downBufferedUntilTick = 0;
}

/**
 * A one-pixel tolerance below the ground plane still counts as grounded. Landing
 * leaves sub-pixel residuals, and without the tolerance a fighter flickers
 * between grounded and airborne on the frame it touches down.
 */
export function isAirborne(fighter: SimFighter): boolean {
  return fighter.y < GROUND_Y - 1;
}

export function isKO(fighter: SimFighter): boolean {
  return fighter.state === FighterState.KO;
}

export function isAttacking(fighter: SimFighter): boolean {
  return (
    fighter.state === FighterState.LIGHT_ATTACK ||
    fighter.state === FighterState.HEAVY_ATTACK ||
    fighter.state === FighterState.SPECIAL ||
    fighter.state === FighterState.ULTIMATE
  );
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * One tick of movement integration.
 *
 * Order matters and is ported verbatim: gravity, then `y`, then `x`. The
 * `vy < 0` term is what lets the first tick of a jump lift off, before `y` has
 * moved far enough for `isAirborne` to be true.
 */
export function stepPhysics(fighter: SimFighter): void {
  if (isAirborne(fighter) || fighter.vy < 0) {
    fighter.vy += GRAVITY * DT;
    fighter.y += fighter.vy * DT;
    fighter.x += fighter.vx * DT;
    if (fighter.y >= GROUND_Y) {
      fighter.y = GROUND_Y;
      fighter.vy = 0;
      // Only a jump resolves to IDLE on landing; a fighter knocked into the air
      // stays in HITSTUN until its timer runs out.
      if (fighter.state === FighterState.JUMP) fighter.state = FighterState.IDLE;
    }
  } else if (!isSelfPropelledAttack(fighter)) {
    fighter.x += fighter.vx * DT;
  }

  if (
    fighter.state === FighterState.HITSTUN ||
    fighter.state === FighterState.BLOCKSTUN ||
    fighter.state === FighterState.KO
  ) {
    fighter.vx *= STUN_FRICTION_PER_TICK;
  }

  fighter.x = clamp(fighter.x, ARENA_MIN_X, ARENA_MAX_X);
}

/**
 * Dash and slide attacks drive themselves forward during their active frames, so
 * applying `vx` on top would move them at double speed.
 */
function isSelfPropelledAttack(fighter: SimFighter): boolean {
  const kind = fighter.attack?.kind;
  return kind === 'dash' || kind === 'slide';
}
