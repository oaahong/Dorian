import { FighterState } from '../fighters/FighterState';
import type { TickSpec } from './attackSpecs';
import { HEAVY_SPEC, LIGHT_SPEC } from './attackSpecs';
import {
  ATTACK_MULTIPLIER,
  CROUCH_HURTBOX_SCALE,
  FIGHTER_HURTBOX_HEIGHT,
  FIGHTER_HURTBOX_WIDTH,
  HP_STAT_MITIGATION,
  MAX_ENERGY,
  MAX_HP,
  RANGE_MULTIPLIER,
  msToTicks,
} from './constants';
import { config, isAirborne, isAttacking, isKO } from './fighter';
import type { ImpactWeight, PlayerIndex, Rect, SimEvent, SimFighter } from './types';

/**
 * Collision geometry and hit resolution, ported from CombatSystem and
 * Fighter.receiveImpact with the Phaser display objects, tweens and audio calls
 * removed. See docs/sim-spec.md §5-7.
 */

// --- Geometry ---------------------------------------------------------------

/** Axis-aligned overlap. Touching edges do not count, matching Phaser's test. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Melee boxes start this far in front of the fighter's centre. */
const MELEE_BOX_OFFSET = 34;
const MELEE_BOX_HEIGHT = 100;
const MELEE_BOX_HEIGHT_CROUCHING = 70;

export function getHurtbox(fighter: SimFighter): Rect {
  const crouching =
    fighter.state === FighterState.CROUCH || (fighter.attack?.crouching ?? false);
  const height = crouching
    ? FIGHTER_HURTBOX_HEIGHT * CROUCH_HURTBOX_SCALE
    : FIGHTER_HURTBOX_HEIGHT;
  return {
    x: fighter.x - FIGHTER_HURTBOX_WIDTH / 2,
    y: fighter.y - height,
    width: FIGHTER_HURTBOX_WIDTH,
    height,
  };
}

export function getMeleeHitbox(fighter: SimFighter, spec: TickSpec): Rect {
  const reach = spec.reach * RANGE_MULTIPLIER(config(fighter).rangeStat);
  const crouching = fighter.attack?.crouching ?? false;
  const airborne = fighter.attack?.airborne ?? false;
  const height = crouching ? MELEE_BOX_HEIGHT_CROUCHING : MELEE_BOX_HEIGHT;
  const centerY = fighter.y - (crouching ? 58 : airborne ? 100 : 108);
  const x =
    fighter.facing > 0
      ? fighter.x + MELEE_BOX_OFFSET
      : fighter.x - MELEE_BOX_OFFSET - reach;
  return { x, y: centerY - height / 2, width: reach, height };
}

// --- Blocking ---------------------------------------------------------------

/**
 * Evaluated on the defender at the moment of impact, not when the input was read.
 *
 * Note that `guardHeld` carries no range condition — only the BLOCK *stance*
 * does. A fighter walking away from a distant opponent therefore still blocks an
 * incoming projectile. Preserved from the original; see docs/sim-spec.md §5.
 */
export function canBlockImpact(fighter: SimFighter): boolean {
  if (fighter.state === FighterState.BLOCK || fighter.state === FighterState.BLOCKSTUN) {
    return true;
  }
  return (
    fighter.guardHeld &&
    !isAirborne(fighter) &&
    !isAttacking(fighter) &&
    fighter.state !== FighterState.HITSTUN &&
    fighter.state !== FighterState.KO &&
    fighter.state !== FighterState.VICTORY
  );
}

// --- Impact -----------------------------------------------------------------

const BLOCKED_KNOCKBACK_SCALE = 0.24;
const KO_MIN_KNOCKBACK_X = 420;
const KO_KNOCKBACK_X_SCALE = 1.55;
const KO_MIN_KNOCKBACK_Y = -260;
const KO_KNOCKBACK_Y_SCALE = 1.5;
/** An aura hit inside its own lock-out window is capped to this much stun. */
const AURA_REPEAT_STUN_TICKS = msToTicks(180);

export function addEnergy(fighter: SimFighter, amount: number): void {
  fighter.energy = clamp(fighter.energy + amount, 0, MAX_ENERGY);
}

export function receiveImpact(
  fighter: SimFighter,
  damage: number,
  spec: TickSpec,
  attackerFacing: 1 | -1,
  blocked: boolean,
  tick: number,
): void {
  if (isKO(fighter)) return;

  fighter.hp = clamp(fighter.hp - damage, 0, MAX_HP);
  fighter.vx = attackerFacing * spec.knockbackX * (blocked ? BLOCKED_KNOCKBACK_SCALE : 1);
  if (!blocked) fighter.vy = spec.knockbackY;

  if (fighter.hp <= 0) {
    fighter.state = FighterState.KO;
    fighter.attack = null;
    fighter.stateRemainingTicks = 0;
    fighter.vx =
      attackerFacing * Math.max(KO_MIN_KNOCKBACK_X, spec.knockbackX * KO_KNOCKBACK_X_SCALE);
    fighter.vy = Math.min(KO_MIN_KNOCKBACK_Y, spec.knockbackY * KO_KNOCKBACK_Y_SCALE);
    return;
  }

  if (blocked) {
    fighter.state = FighterState.BLOCKSTUN;
    fighter.stateRemainingTicks = spec.blockstunTicks;
  } else {
    fighter.state = FighterState.HITSTUN;
    let hitstun = spec.hitstunTicks;
    if (spec.kind === 'aura') {
      // An aura that already stunned this fighter recently only applies a token
      // amount, so it cannot be looped into an infinite lock.
      if (tick < fighter.stunLockoutUntilTick) {
        hitstun = Math.min(AURA_REPEAT_STUN_TICKS, hitstun);
      } else {
        fighter.stunLockoutUntilTick = tick + spec.stunLockoutTicks;
      }
    }
    fighter.stateRemainingTicks = hitstun;
  }
  // Any connected hit cancels whatever the defender was doing.
  fighter.attack = null;
}

// --- Resolution -------------------------------------------------------------

export interface HitResult {
  blocked: boolean;
  damage: number;
  hitStopTicks: number;
}

/** How much the whole simulation freezes for, by impact weight. */
const HIT_STOP_TICKS: Record<ImpactWeight | 'blocked', number> = {
  blocked: msToTicks(35),
  light: msToTicks(45),
  heavy: msToTicks(80),
  special: msToTicks(95),
  ultimate: msToTicks(150),
};

/** Meter earned on a blocked hit, as a share of the clean-hit value. */
const BLOCKED_ENERGY_SHARE = 0.35;

/**
 * The original passed the impact weight in at each call site; deriving it from
 * the spec keeps the two in step and removes an argument that could disagree
 * with the attack it describes.
 */
export function impactWeight(spec: TickSpec): ImpactWeight {
  if (spec.id === LIGHT_SPEC.id) return 'light';
  if (spec.id === HEAVY_SPEC.id) return 'heavy';
  return spec.kind.startsWith('ultimate-') ? 'ultimate' : 'special';
}

/**
 * Apply one connected hit. Returns null if there was nothing to hit, so callers
 * can distinguish "resolved" from "the defender was already down".
 */
export function resolveHit(
  attacker: SimFighter,
  defender: SimFighter,
  spec: TickSpec,
  tick: number,
  attackerIndex: PlayerIndex,
  events: SimEvent[],
): HitResult | null {
  if (isKO(defender)) return null;

  const blocked = canBlockImpact(defender);
  const fullDamage =
    spec.damage *
    ATTACK_MULTIPLIER(config(attacker).attackStat) *
    HP_STAT_MITIGATION(config(defender).hpStat);
  const damage = blocked ? fullDamage * spec.chipRatio : fullDamage;

  receiveImpact(defender, damage, spec, attacker.facing, blocked, tick);

  if (!blocked) {
    addEnergy(attacker, spec.energyOnHit);
    addEnergy(defender, spec.energyOnReceive);
  } else if (spec.chipRatio > 0) {
    addEnergy(attacker, Math.ceil(spec.energyOnHit * BLOCKED_ENERGY_SHARE));
    addEnergy(defender, Math.ceil(spec.energyOnReceive * BLOCKED_ENERGY_SHARE));
  }

  const weight = impactWeight(spec);
  const hitStopTicks = blocked ? HIT_STOP_TICKS.blocked : HIT_STOP_TICKS[weight];

  events.push({
    t: 'hit',
    player: attackerIndex,
    specId: spec.id,
    impact: weight,
    blocked,
    // Where the original drew its spark, kept so the view does not have to
    // rediscover it.
    x: defender.x - attacker.facing * 18,
    y: defender.y - 120,
  });

  return { blocked, damage, hitStopTicks };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
