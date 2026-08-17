import type { AttackSpec } from '../combat/AttackSpec';

export interface FighterPalette {
  primary: number;
  secondary: number;
  accent: number;
}

/**
 * The special moves a fighter has, keyed by the motion that calls each one.
 *
 * Named rather than an array because the motion is part of a move's identity:
 * every fighter's `quarterForward` is its fireball-slot move, and a training
 * display or a CPU can say so without a lookup table. `dragonPunch` is optional
 * because only one fighter carries a fourth special.
 */
export interface FighterSpecials {
  /** 236 — the defining, generally safe one. */
  quarterForward: AttackSpec;
  /** 214 — the situational one. */
  quarterBack: AttackSpec;
  /** 623 — reversal or escape. */
  dragonPunch?: AttackSpec;
  /** Double-tap down — utility: armour, meter, a counter stance. */
  functionMove: AttackSpec;
}

export type MotionSlot = keyof FighterSpecials;

export interface FighterConfig {
  id: string;
  number: string;
  name: string;
  shortName: string;
  archetype: string;
  tagline: string;
  hpStat: number;
  attackStat: number;
  speedStat: number;
  rangeStat: number;
  controlStat: number;
  cardTexture: string;
  specials: FighterSpecials;
  ultimate: AttackSpec;
  palette: FighterPalette;
  /**
   * Final multiplier on damage taken, on top of `hpStat` mitigation.
   *
   * The stat is a coarse 1..5 dial shared with the rest of the balance maths;
   * this is the per-fighter trim the upgraded build tuned separately. They do
   * different jobs — a fighter can read as sturdy on the select screen and still
   * be the one that folds to a long string.
   */
  damageTakenScalar: number;
}

/** Every special a fighter actually has, in motion order. */
export function allSpecials(config: FighterConfig): AttackSpec[] {
  const { quarterForward, quarterBack, dragonPunch, functionMove } = config.specials;
  return dragonPunch
    ? [quarterForward, quarterBack, dragonPunch, functionMove]
    : [quarterForward, quarterBack, functionMove];
}
