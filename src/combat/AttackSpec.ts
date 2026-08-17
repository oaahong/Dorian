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
   * Meter awarded when the move finishes its recovery, rather than on contact.
   *
   * This is how the utility moves pay: a taunt or a flex earns its meter for
   * having been held through, and whiffing is not a thing it can do.
   */
  meterOnComplete?: number;
}

export const LIGHT_ATTACK: AttackSpec = {
  id: 'light',
  name: 'LIGHT',
  kind: 'melee',
  startup: 5,
  active: 5,
  recovery: 10,
  damage: 5,
  hitstun: 11,
  blockstun: 5,
  knockbackX: 150,
  knockbackY: -40,
  reach: 78,
  chipRatio: 0,
  energyOnHit: 5,
  energyOnReceive: 3,
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
  startup: 11,
  active: 7,
  recovery: 18,
  damage: 9,
  hitstun: 18,
  blockstun: 9,
  knockbackX: 255,
  knockbackY: -110,
  reach: 104,
  chipRatio: 0,
  energyOnHit: 8,
  energyOnReceive: 5,
};
