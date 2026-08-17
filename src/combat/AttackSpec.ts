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
 * conversion and the whole class of bug with it. The current values were produced
 * by applying the old rounding once and keeping the result, so this is exactly the
 * frame data the game was already running — see the golden replays, which are
 * unchanged.
 *
 * It also happens to be the unit the delivered upgraded build authors in, which is
 * what lets its movesets be dropped in as data rather than translated.
 */
export type AttackKind =
  | 'melee'
  | 'sonic'
  | 'water'
  | 'dash'
  | 'aura'
  | 'salad'
  | 'slide'
  | 'beam'
  | 'zone'
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
