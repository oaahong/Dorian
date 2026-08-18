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
 * What a move may be cancelled into before it has finished recovering.
 *
 * A cancel is what turns two moves into a combo: the attacker gives up the rest
 * of their recovery and starts something else, so the opponent never gets their
 * turn back. The condition is what keeps it honest — `hit` and `hitOrBlock` both
 * require the move to have *connected*, so a whiffed normal is still punishable
 * and mashing cancels into thin air is not a strategy.
 */
export interface CancelRule {
  into: 'special' | 'rush';
  on: 'hit' | 'block' | 'hitOrBlock';
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
  /**
   * Meter this move costs to start, spent up front rather than on contact.
   *
   * Absent means free. The ultimate does not use it — its cost is the whole bar
   * by definition and is checked where the bar is — but every meme move does, and
   * paying on startup is what makes a whiffed Impact hurt.
   */
  meterCost?: number;
  /** What this may be cancelled into, and on what result. */
  cancels?: CancelRule[];
}

/**
 * The three universal meme moves, on button pairs rather than motions.
 *
 * Every fighter has all three, they cost meter rather than a motion, and they are
 * the layer the roster's own specials sit on top of — the reason two fighters
 * with nothing in common still play the same game. The upgraded build put them on
 * chords for the same reason the genre does: a pair of buttons is reachable from
 * any stance and cannot be fumbled into a direction.
 */

/**
 * Light + Heavy after a normal connects: spend 20 and take your turn back.
 *
 * It has no hitbox at all — reach zero, damage zero. Every bit of its value is
 * the cancel itself: the normal's recovery is thrown away and the fighter is left
 * standing next to an opponent still in hitstun. That is the whole combo engine,
 * and it is why it is the one move here that cannot be started on its own.
 */
export const MEME_RUSH: AttackSpec = {
  id: 'meme-rush',
  name: 'MEME RUSH',
  kind: 'dashStrike',
  attackType: 'mid',
  startup: 1,
  active: 1,
  recovery: 8,
  damage: 0,
  hitstun: 0,
  blockstun: 0,
  knockbackX: 0,
  knockbackY: 0,
  reach: 0,
  chipRatio: 0,
  energyOnHit: 0,
  energyOnReceive: 0,
  meterCost: 20,
};

/**
 * Light + Special: six frames of immunity to everything a throw is not.
 *
 * Expressed entirely as invulnerability windows rather than as a mechanism of its
 * own, because that is exactly what a parry is and the simulation already knows
 * how to read those. Throws are the answer to it, which is the same answer they
 * are to blocking — listing the three categories it *does* cover is how that gets
 * said, and it is deliberately not `'all'`.
 *
 * The one-minute cooldown is the cost. There is no meter price, so without it the
 * correct play against any pressure would be to hold both buttons.
 */
export const MEME_PARRY: AttackSpec = {
  id: 'meme-parry',
  name: 'MEME PARRY',
  kind: 'parry',
  attackType: 'mid',
  startup: 1,
  active: 6,
  recovery: 20,
  damage: 0,
  hitstun: 0,
  blockstun: 0,
  knockbackX: 0,
  knockbackY: 0,
  reach: 0,
  chipRatio: 0,
  energyOnHit: 0,
  energyOnReceive: 0,
  cooldown: 60,
  invulnerable: [
    { against: 'strike', from: 1, to: 6 },
    { against: 'projectile', from: 1, to: 6 },
    { against: 'airAttack', from: 1, to: 6 },
  ],
};

/**
 * Heavy + Special: 25 meter for a slow, long, armoured swing.
 *
 * Twenty-six frames of startup is an age, and the armour does not begin until the
 * eighth — so it loses to anything fast enough to catch the front of it, and beats
 * anything thrown at it after. That trade is the move.
 */
export const MEME_IMPACT: AttackSpec = {
  id: 'meme-impact',
  name: 'MEME IMPACT',
  kind: 'burst',
  attackType: 'mid',
  startup: 26,
  active: 4,
  recovery: 28,
  damage: 13,
  hitstun: 22,
  blockstun: 14,
  knockbackX: 300,
  knockbackY: -140,
  reach: 150,
  chipRatio: 0,
  energyOnHit: 8,
  energyOnReceive: 5,
  meterCost: 25,
  armor: { against: 'strike', hits: 2, from: 8, to: 24 },
};

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
  // The lights cancel on block as well as on hit: that is what makes a light the
  // move you start pressure with, since a blocked one still keeps your turn.
  cancels: [
    { into: 'special', on: 'hitOrBlock' },
    { into: 'rush', on: 'hitOrBlock' },
  ],
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
  cancels: [
    { into: 'special', on: 'hitOrBlock' },
    { into: 'rush', on: 'hitOrBlock' },
  ],
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
  // Heavies cancel on hit only. A blocked heavy is meant to be your problem —
  // twenty-one frames of recovery with the opponent's turn starting is exactly
  // the punish a sweep should be risking.
  cancels: [{ into: 'special', on: 'hit' }, { into: 'rush', on: 'hit' }],
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
  cancels: [{ into: 'special', on: 'hit' }, { into: 'rush', on: 'hit' }],
};
