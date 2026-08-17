/**
 * What an attack *does*, which is what the simulation switches on.
 *
 * These are behaviours, not flavours. Two moves share a kind when the simulation
 * would do the same thing with them, however differently they are drawn — which
 * is why `burst`, `antiAir` and `commandThrow` are separate (their boxes, their
 * categories or their propulsion differ) while a dozen visually distinct fireballs
 * are all `projectile`.
 */
export type AttackKind =
  // Swung at arm's length: a box in front of the fighter, tested every active tick.
  | 'melee'
  | 'strike'
  | 'multiStrike'
  | 'antiAir'
  | 'burst'
  | 'counter'
  | 'commandThrow'
  // Self-propelled: the same box, but the fighter drives forward under it.
  | 'dash'
  | 'slide'
  | 'dashStrike'
  // Something leaves the fighter and travels.
  | 'sonic'
  | 'water'
  | 'salad'
  | 'projectile'
  | 'summon'
  // Placed or fired geometry.
  | 'aura'
  | 'beam'
  | 'zone'
  // No hitbox at all. These occupy the fighter and do their work through
  // armour, invulnerability or meter rather than by touching anyone.
  | 'armor'
  | 'parry'
  | 'hide'
  | 'install'
  | 'meterCharge'
  | 'ultimate-sonic'
  | 'ultimate-water'
  | 'ultimate-ok'
  | 'ultimate-social'
  | 'ultimate-salad'
  | 'ultimate-freeze'
  | 'ultimate-alien'
  | 'ultimate-magic';

/**
 * What a hit counts as, for the windows below.
 *
 * Derived from the attack rather than authored on it, so a move cannot claim to
 * be a category it does not behave like — see `hitCategory` in the simulation.
 */
export type HitCategory = 'strike' | 'projectile' | 'throw' | 'airAttack';

/**
 * Which guard answers an attack — the high/low game.
 *
 * This is authored, not derived, because it is a *claim about the animation*
 * rather than about the mechanics: a sweep and a jab are the same box with the
 * same propulsion, and nothing the simulation can measure tells them apart. It is
 * the one place where what the art shows has to be written down.
 *
 * `low` must be crouch-blocked, `overhead` must be stand-blocked, and `mid` is
 * answered by either. `air`, `throw` and `projectile` are the categories that
 * never had a guard height to begin with; they are listed so that every move
 * names its own answer instead of falling into `mid` by omission.
 */
export type AttackType = 'mid' | 'low' | 'overhead' | 'air' | 'throw' | 'projectile';

/** `'all'` covers every category, including throws. */
export type HitCategoryFilter = HitCategory | 'all';

/**
 * A window during which the attacker cannot be hit at all by the listed
 * category. Ticks are inclusive and measured from the first tick of the attack,
 * so `from: 1` is the first startup frame.
 */
export interface InvulnerabilityWindow {
  against: HitCategoryFilter;
  from: number;
  to: number;
}

/**
 * A window that absorbs hits instead of being interrupted by them.
 *
 * Armour is not invulnerability: the damage still lands and the meter is still
 * awarded, but the attack continues rather than being cancelled into hitstun.
 * That is what makes an armoured approach a read rather than a free pass.
 */
export interface ArmorWindow {
  against: HitCategoryFilter;
  /** How many hits it eats before it is spent. */
  hits: number;
  from: number;
  to: number;
}

/**
 * Authored frame data for one attack.
 *
 * **Every duration here is in ticks**, at the fixed TICK_HZ of the simulation —
 * `startup: 5` is five ticks, not five milliseconds.
 *
 * This used to be authored in milliseconds and rounded to ticks at module load,
 * which meant the numbers a designer typed were never quite the numbers the game
 * ran: LIGHT's 90 ms startup became 5 ticks, or 83.3 ms, and no amount of tuning
 * the 90 could express 5.5. Rounding also had to be re-proved safe every time a
 * value changed, because a window under half a tick silently became zero and made
 * an attack unable to connect at all.
 *
 * Ticks are what the simulation counts, so authoring in ticks removes the
 * conversion and the whole class of bug with it. It is also the unit the upgraded
 * build authored in, which is what let its movesets arrive as data rather than as
 * a translation.
 */
export interface AttackSpec {
  id: string;
  name: string;
  kind: AttackKind;
  /**
   * Which guard answers this, defaulting to `mid` — blockable either way.
   *
   * `mid` is the default because it is the *safe* one to get wrong: a move that
   * should have been an overhead but is left unmarked is merely less rewarding,
   * whereas one silently promoted to unblockable-while-standing would be a hole
   * in the defence of every fighter, put there by omission.
   */
  attackType?: AttackType;
  startup: number;
  active: number;
  recovery: number;
  /** Total damage. For a multi-hit attack this is the sum of `hits`. */
  damage: number;
  hitstun: number;
  blockstun: number;
  knockbackX: number;
  knockbackY: number;
  reach: number;
  cooldown?: number;
  chipRatio?: number;
  energyOnHit: number;
  energyOnReceive: number;
  projectileSpeed?: number;
  lifetime?: number;
  telegraph?: number;
  stunLockout?: number;
  /**
   * How long a `zone` lingers once its telegraph expires.
   *
   * Separate from `active`, which is how long the *fighter* is committed to the
   * move. A zone that outlives its caster's recovery is the whole point of a
   * setup move, and before this existed the two shared one number — so a
   * long-lasting zone meant a fighter frozen in place for as long as it lasted.
   * Defaults to `active`.
   */
  zoneDuration?: number;

  /**
   * Damage of each hit of a multi-hit attack, in order. One connect applies one
   * entry; the attack can then reconnect once `rehitTicks` have passed, until the
   * list is used up.
   */
  hits?: number[];
  /** Ticks between the hits of a multi-hit attack. */
  rehitTicks?: number;
  invulnerable?: InvulnerabilityWindow[];
  armor?: ArmorWindow;
  /** Throws: cannot be blocked, and cannot catch an airborne defender. */
  unblockable?: boolean;
  /** A knockdown the defender cannot recover from early. */
  hardKnockdown?: boolean;
  /**
   * How many projectiles a `summon` puts out, trailing each other in a column.
   *
   * One is the default and covers every ordinary fireball. A summon's whole idea is
   * that it keeps arriving, so a single one that misses is not the end of it.
   */
  projectileCount?: number;
  /**
   * A timed buff the *attacker* gains when the move completes.
   *
   * On completion rather than on contact, because an install is paid for with the
   * frames it takes rather than with a successful read.
   */
  selfStatus?: { kind: 'install'; ticks: number };
  /** A timed debuff the *defender* takes from a clean hit. */
  hitStatus?: { kind: 'slow'; ticks: number };
  /**
   * Draw a trail of fading copies behind the fighter while this is active.
   *
   * Purely cosmetic, and deliberately declared on the move rather than inferred
   * from its speed: 九命殘影 is a *nine-lives afterimage*, which is a story about
   * the character, not a side effect of how fast it happens to travel.
   */
  afterimage?: boolean;
  /**
   * Meter awarded when the move finishes its recovery, rather than on contact.
   *
   * This is how the utility moves pay: a taunt or a flex earns its meter for
   * having been held through, and whiffing is not a thing it can do.
   */
  meterOnComplete?: number;
}

/**
 * The six normals every fighter has, one per stance and strength.
 *
 * There used to be two — one light and one heavy, swung identically whether the
 * fighter was standing, crouching or in the air, with only the hurtbox changing.
 * That collapsed the high/low game into nothing: crouching altered how you were
 * *hit*, never what you *threw*, so there was no low to block low against.
 *
 * The timings, damage and reach are the upgraded build's, which authored all six.
 * The knockback figures are not — those are velocities in this simulation's units
 * and have no counterpart there, so they are set here to keep each new normal in
 * proportion to the standing one it is a variant of.
 */
export const LIGHT_ATTACK: AttackSpec = {
  id: 'light',
  name: 'LIGHT',
  kind: 'melee',
  attackType: 'mid',
  startup: 4,
  active: 2,
  recovery: 8,
  damage: 4,
  hitstun: 11,
  blockstun: 7,
  knockbackX: 150,
  knockbackY: -40,
  reach: 92,
  chipRatio: 0,
  energyOnHit: 4,
  energyOnReceive: 2,
};

/**
 * The low. Slower and shorter-ranged than the standing light, and it has to be
 * crouch-blocked — which is the whole reason to give up the standing guard for it.
 */
export const CROUCH_LIGHT_ATTACK: AttackSpec = {
  id: 'crouch-light',
  name: 'CROUCH LIGHT',
  kind: 'melee',
  attackType: 'low',
  startup: 5,
  active: 2,
  recovery: 9,
  damage: 4,
  hitstun: 10,
  blockstun: 6,
  knockbackX: 120,
  knockbackY: 0,
  reach: 96,
  chipRatio: 0,
  energyOnHit: 4,
  energyOnReceive: 2,
};

/** The sweep: the longest normal in the game, and the slowest to recover from. */
export const CROUCH_HEAVY_ATTACK: AttackSpec = {
  id: 'crouch-heavy',
  name: 'CROUCH HEAVY',
  kind: 'melee',
  attackType: 'low',
  startup: 10,
  active: 4,
  recovery: 21,
  damage: 10,
  hitstun: 18,
  blockstun: 9,
  knockbackX: 230,
  knockbackY: -150,
  reach: 128,
  chipRatio: 0,
  energyOnHit: 7,
  energyOnReceive: 4,
};

/**
 * The air normals, which cannot be crouch-blocked *or* stand-blocked wrongly —
 * `air` is answered by either guard. What makes them worth the jump is the six
 * and seven active frames: an air-to-ground swing has to stay out long enough to
 * survive the arc it is thrown from.
 */
export const JUMP_LIGHT_ATTACK: AttackSpec = {
  id: 'jump-light',
  name: 'JUMP LIGHT',
  kind: 'melee',
  attackType: 'air',
  startup: 4,
  active: 6,
  recovery: 8,
  damage: 4,
  hitstun: 11,
  blockstun: 7,
  knockbackX: 150,
  knockbackY: -40,
  reach: 96,
  chipRatio: 0,
  energyOnHit: 4,
  energyOnReceive: 2,
};

export const JUMP_HEAVY_ATTACK: AttackSpec = {
  id: 'jump-heavy',
  name: 'JUMP HEAVY',
  kind: 'melee',
  attackType: 'air',
  startup: 7,
  active: 7,
  recovery: 14,
  damage: 8,
  hitstun: 16,
  blockstun: 9,
  knockbackX: 240,
  knockbackY: -100,
  reach: 118,
  chipRatio: 0,
  energyOnHit: 7,
  energyOnReceive: 4,
};

/**
 * The universal throw, on its own button.
 *
 * Every fighter has this one; it is the answer to a turtling opponent, which is
 * why it is unblockable and why its reach is shorter than either normal. Five
 * frames of startup make it fast enough to be a real threat up close and slow
 * enough to be jumped — and a whiffed one leaves twenty frames of recovery, which
 * is the price for guessing wrong.
 *
 * `goblin`'s 鎖喉告白 is a *command* throw: more damage and more reach for a motion
 * input and a longer commitment. This is the one anybody can do.
 */
export const THROW_ATTACK: AttackSpec = {
  id: 'throw',
  name: 'THROW',
  kind: 'commandThrow',
  attackType: 'throw',
  startup: 5,
  active: 3,
  recovery: 20,
  damage: 12,
  hitstun: 20,
  // Nothing to block, so nothing to be stunned by blocking it.
  blockstun: 1,
  knockbackX: 240,
  knockbackY: -70,
  reach: 76,
  chipRatio: 0,
  energyOnHit: 8,
  energyOnReceive: 5,
  unblockable: true,
  hardKnockdown: true,
};

export const HEAVY_ATTACK: AttackSpec = {
  id: 'heavy',
  name: 'HEAVY',
  kind: 'melee',
  attackType: 'mid',
  startup: 9,
  active: 3,
  recovery: 18,
  damage: 9,
  hitstun: 17,
  blockstun: 10,
  knockbackX: 255,
  knockbackY: -110,
  reach: 118,
  chipRatio: 0,
  energyOnHit: 7,
  energyOnReceive: 4,
};
