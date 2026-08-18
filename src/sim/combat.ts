import type { HitCategory, HitCategoryFilter } from '../combat/AttackSpec';
import { FighterState } from '../fighters/FighterState';
import type { TickSpec } from './attackSpecs';
import { getSpec, NORMALS } from './attackSpecs';
import {
  ATTACK_MULTIPLIER,
  COMBO_SCALING,
  COMBO_WINDOW_TICKS,
  THROW_TECH_TICKS,
  CROUCH_HURTBOX_SCALE,
  INSTALL_DAMAGE_MULTIPLIER,
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
    fighter.state === FighterState.CROUCH ||
    fighter.guardCrouching ||
    (fighter.attack?.crouching ?? false);
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
export function canBlockImpact(fighter: SimFighter, spec: TickSpec): boolean {
  return isGuarding(fighter) && guardAnswers(fighter, spec.attackType);
}

/** Whether the fighter is in a position to guard at all, height aside. */
function isGuarding(fighter: SimFighter): boolean {
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

/**
 * Whether the guard the fighter is *currently* holding is the right height.
 *
 * Read from the live stick position rather than from whatever it was when the
 * guard started, so a defender can switch between the two mid-blockstring — which
 * is the entire game the high/low system exists to create. Blocking the first hit
 * of a string earns you nothing toward the second.
 */
function guardAnswers(fighter: SimFighter, type: TickSpec['attackType']): boolean {
  if (type === 'low') return fighter.guardCrouching;
  // Overheads and air attacks both come from above, and neither is answered by a
  // low guard. Grouping them matches the upgraded build's table, where a crouching
  // guard covers only Low, Mid and Projectile.
  if (type === 'overhead' || type === 'air') return !fighter.guardCrouching;
  return true;
}

// --- Categories, invulnerability and armour ---------------------------------

/**
 * What an attack counts as, derived rather than authored.
 *
 * Deriving it means a move cannot declare itself a category it does not behave
 * like — an anti-air that claimed to be a projectile would otherwise slip through
 * projectile invulnerability while still swinging a melee box.
 */
export function hitCategory(spec: TickSpec, airborne: boolean): HitCategory {
  if (spec.unblockable) return 'throw';
  if (PROJECTILE_KINDS.has(spec.kind)) return 'projectile';
  return airborne ? 'airAttack' : 'strike';
}

/** Kinds that put something into the world rather than swinging at arm's length. */
const PROJECTILE_KINDS = new Set(['sonic', 'water', 'salad', 'beam', 'zone']);

function windowCovers(from: number, to: number, elapsed: number): boolean {
  // `elapsedTicks` is zero on the first tick of an attack; windows are authored
  // from 1, the way frame data is read in the genre.
  const frame = elapsed + 1;
  return frame >= from && frame <= to;
}

function filterMatches(filter: HitCategoryFilter, category: HitCategory): boolean {
  return filter === 'all' || filter === category;
}

/**
 * Whether `fighter` is currently untouchable by an attack of this category,
 * because of a window on the attack it is itself performing.
 *
 * Pure in the fighter's state, so it can be asked as often as needed.
 */
export function isInvulnerableTo(fighter: SimFighter, category: HitCategory): boolean {
  const attack = fighter.attack;
  if (!attack) return false;
  const spec = getSpec(attack.specId);
  for (const window of spec.invulnerable) {
    if (!filterMatches(window.against, category)) continue;
    if (windowCovers(window.from, window.to, attack.elapsedTicks)) return true;
  }
  return false;
}

/**
 * Whether `fighter` has armour left to absorb an incoming hit of this category.
 *
 * Read-only. Spending the charge is `consumeArmor`, so that a hit which is
 * refused for some other reason does not silently burn it.
 */
export function hasArmorAgainst(fighter: SimFighter, category: HitCategory): boolean {
  const attack = fighter.attack;
  if (!attack) return false;
  const armor = getSpec(attack.specId).armor;
  if (!armor) return false;
  // Throws beat armour. Otherwise an armoured approach would have no answer and
  // the whole rock-paper-scissors of the genre collapses.
  if (category === 'throw') return false;
  if (!filterMatches(armor.against, category)) return false;
  if (!windowCovers(armor.from, armor.to, attack.elapsedTicks)) return false;
  return attack.armorUsed < armor.hits;
}

export function consumeArmor(fighter: SimFighter): void {
  if (fighter.attack) fighter.attack.armorUsed += 1;
}

/** Meter for reading an attack correctly, rather than for landing one. */
const PARRY_REWARD = 7;
const ARMOR_REWARD = 4;
/** How far apart a teched throw leaves the two of them. */
const THROW_TECH_PUSH = 190;

/**
 * Pay a defender who refused a hit outright.
 *
 * Invulnerability is otherwise its own reward and nothing more, which makes a
 * parry strictly worse than blocking: same outcome, tighter timing, longer
 * recovery. The meter is what turns reading an attack into a resource, and it is
 * only paid for the moves whose *whole job* is the read.
 */
function rewardRefusal(defender: SimFighter): void {
  const kind = defender.attack ? getSpec(defender.attack.specId).kind : null;
  if (kind === 'parry' || kind === 'hide') addEnergy(defender, PARRY_REWARD);
}

function pushApart(a: SimFighter, b: SimFighter): void {
  const direction = a.x <= b.x ? -1 : 1;
  a.vx = direction * THROW_TECH_PUSH;
  b.vx = -direction * THROW_TECH_PUSH;
  a.attack = null;
  b.attack = null;
}

// --- Impact -----------------------------------------------------------------

const BLOCKED_KNOCKBACK_SCALE = 0.24;
const KO_MIN_KNOCKBACK_X = 420;
const KO_KNOCKBACK_X_SCALE = 1.55;
const KO_MIN_KNOCKBACK_Y = -260;
const KO_KNOCKBACK_Y_SCALE = 1.5;
/** An aura hit inside its own lock-out window is capped to this much stun. */
const AURA_REPEAT_STUN_TICKS = msToTicks(180);
/** How much longer a hard knockdown keeps the defender down. */
const HARD_KNOCKDOWN_SCALE = 1.5;

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
  /**
   * An armoured defender takes the damage and keeps going: no knockback, no
   * stun, and the attack it was performing is not cancelled.
   */
  armored = false,
): void {
  if (isKO(fighter)) return;

  fighter.hp = clamp(fighter.hp - damage, 0, MAX_HP);

  if (armored && fighter.hp > 0) return;
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
    // A hard knockdown is the reward for landing a command throw: the defender
    // stays down for half again as long and cannot act out of it early.
    if (spec.hardKnockdown) hitstun = Math.round(hitstun * HARD_KNOCKDOWN_SCALE);
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
  armored: boolean;
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

/**
 * How long the world freezes for one beat of an ultimate.
 *
 * Not the ultimate's own weight, which is what the spec would give every phase.
 * A finisher earns the full stop; the nine 2.3-damage jabs of a grab do not, and
 * charging each of them nine ticks of freeze stretched a 145-tick timeline past
 * 250 and left the victim held long after the move should have let go. Scaled by
 * what the beat actually did, so the pauses land where the impact is.
 */
export function ultimatePhaseHitStop(damage: number): number {
  if (damage >= 12) return HIT_STOP_TICKS.ultimate;
  if (damage >= 6) return HIT_STOP_TICKS.heavy;
  return HIT_STOP_TICKS.light;
}

/** Meter earned on a blocked hit, as a share of the clean-hit value. */
const BLOCKED_ENERGY_SHARE = 0.35;

/**
 * When a hit caught the defender, relative to what *they* were doing.
 *
 * The genre's oldest reward: interrupting a move on the way out is a counter
 * hit, and catching one on the way back is a punish. Both mean the defender
 * chose wrongly rather than merely stood there, and both pay more than hitting
 * somebody who was doing nothing.
 */
export type HitTiming = 'neutral' | 'counter' | 'punish';

const COUNTER_STUN: Record<HitTiming, number> = { neutral: 0, counter: 2, punish: 3 };
const COUNTER_DAMAGE: Record<HitTiming, number> = { neutral: 1, counter: 1, punish: 1.1 };

export function hitTiming(defender: SimFighter): HitTiming {
  const attack = defender.attack;
  if (!attack) return 'neutral';
  const spec = getSpec(attack.specId);
  if (attack.elapsedTicks < spec.startupTicks) return 'counter';
  if (attack.elapsedTicks >= spec.startupTicks + spec.activeTicks) return 'punish';
  return 'neutral';
}

/**
 * Count this hit toward the attacker's string.
 *
 * A combo *continues* only if the defender was already in hitstun — otherwise it
 * is a fresh opening and the count restarts. That is what makes scaling a
 * property of the string rather than of how busy the last few seconds were.
 */
function extendCombo(attacker: SimFighter, defender: SimFighter): void {
  const continuing = defender.state === FighterState.HITSTUN && attacker.comboTicks > 0;
  attacker.comboHits = continuing ? attacker.comboHits + 1 : 1;
  attacker.comboTicks = COMBO_WINDOW_TICKS;
}

/**
 * Built from `NORMALS` rather than listed by hand, so that adding a stance cannot
 * leave one of its two normals silently landing with a special's weight.
 */
const LIGHT_NORMAL_IDS = new Set(Object.values(NORMALS).map((pair) => pair.light.id));
const HEAVY_NORMAL_IDS = new Set(Object.values(NORMALS).map((pair) => pair.heavy.id));

/**
 * The original passed the impact weight in at each call site; deriving it from
 * the spec keeps the two in step and removes an argument that could disagree
 * with the attack it describes.
 */
export function impactWeight(spec: TickSpec): ImpactWeight {
  if (LIGHT_NORMAL_IDS.has(spec.id)) return 'light';
  if (HEAVY_NORMAL_IDS.has(spec.id)) return 'heavy';
  return spec.kind.startsWith('ultimate-') ? 'ultimate' : 'special';
}

/**
 * Apply one connected hit.
 *
 * Returns null when the hit does not land at all — the defender was already down,
 * or invulnerable, or a throw found them airborne. Callers use that to leave the
 * attack's hit mask alone, so an attack that passes through an invulnerable
 * opponent can still connect later in its active window rather than being spent.
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

  const category = hitCategory(spec, attacker.attack?.airborne ?? false);

  if (isInvulnerableTo(defender, category)) {
    rewardRefusal(defender);
    return null;
  }
  // A throw that catches nobody on the ground catches nobody. Without this an
  // anti-air command throw would beat every jump in the game.
  if (category === 'throw' && isAirborne(defender)) return null;

  /**
   * Both reached for a throw, so neither gets one.
   *
   * The escape is the only answer to a throw that is not "do not be standing
   * there", and it has to be — a throw already beats blocking, and a mix-up with
   * no answer at all is a coin flip rather than a read. Both fighters are pushed
   * apart and nobody is hurt.
   */
  if (category === 'throw' && tick - defender.lastThrowPressTick <= THROW_TECH_TICKS) {
    pushApart(attacker, defender);
    events.push({ t: 'throwTech', player: attackerIndex });
    return null;
  }

  // Throws are the answer to blocking, so they ignore it.
  const blocked = !spec.unblockable && canBlockImpact(defender, spec);
  const armored = !blocked && hasArmorAgainst(defender, category);
  if (armored) {
    consumeArmor(defender);
    // Absorbing a hit is a read too, and a more expensive one — the damage still
    // lands. Paying for it is what makes an armoured approach a decision.
    addEnergy(defender, ARMOR_REWARD);
  }

  const hitIndex = attacker.attack ? attacker.attack.hitsUsed : 0;
  const perHitDamage = spec.hits[Math.min(hitIndex, spec.hits.length - 1)]!;
  const defenderConfig = config(defender);
  const install = attacker.installTicks > 0 ? INSTALL_DAMAGE_MULTIPLIER : 1;

  /**
   * Where in the attacker's string this hit falls.
   *
   * Extended before the damage is computed, so the *first* hit of a combo is hit
   * one and scales at full. A blocked hit does not extend it — a blockstring is
   * not a combo, and letting it count would let an attacker pre-scale their own
   * punish by poking a guard first.
   */
  const timing = hitTiming(defender);
  if (!blocked) extendCombo(attacker, defender);
  const raw = blocked ? 1 : COMBO_SCALING(attacker.comboHits);
  // An ultimate floors at half however deep it lands. A super worth nothing as a
  // finisher is a super nobody finishes with, and finishing is what it is for.
  const scaling = spec.kind.startsWith('ultimate-') ? Math.max(0.5, raw) : raw;

  const fullDamage =
    perHitDamage *
    ATTACK_MULTIPLIER(config(attacker).attackStat) *
    install *
    scaling *
    COUNTER_DAMAGE[timing] *
    HP_STAT_MITIGATION(defenderConfig.hpStat) *
    defenderConfig.damageTakenScalar;
  const damage = blocked ? fullDamage * spec.chipRatio : fullDamage;

  const stunned: TickSpec =
    timing === 'neutral' || blocked
      ? spec
      : { ...spec, hitstunTicks: spec.hitstunTicks + COUNTER_STUN[timing] };
  receiveImpact(defender, damage, stunned, attacker.facing, blocked, tick, armored);

  if (!blocked) {
    addEnergy(attacker, spec.energyOnHit);
    addEnergy(defender, spec.energyOnReceive);
    // A debuff is the reward for a clean hit only. Chipping someone's guard should
    // not also glue their feet to the floor.
    if (!armored && spec.hitStatus?.kind === 'slow') {
      defender.slowTicks = Math.max(defender.slowTicks, spec.hitStatus.ticks);
    }
  } else if (spec.chipRatio > 0) {
    addEnergy(attacker, Math.ceil(spec.energyOnHit * BLOCKED_ENERGY_SHARE));
    addEnergy(defender, Math.ceil(spec.energyOnReceive * BLOCKED_ENERGY_SHARE));
  }

  const weight = impactWeight(spec);
  // An absorbed hit gets the blocked freeze: something connected and should be
  // felt, but the full stop belongs to a hit that actually interrupted someone.
  const hitStopTicks = blocked || armored ? HIT_STOP_TICKS.blocked : HIT_STOP_TICKS[weight];

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

  return { blocked, armored, damage, hitStopTicks };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
