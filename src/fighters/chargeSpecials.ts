import type { AttackSpec } from '../combat/AttackSpec';

/**
 * The chargeable special — every fighter's bare-button move, in three strengths.
 *
 * Hold the special button with no motion in front of it and the fighter winds up;
 * release and it fires at whatever level the hold reached. It is the move a player
 * who knows none of the motions will actually use, so it is deliberately the most
 * legible thing in the game: one button, and the longer you hold it the more it
 * does.
 *
 * Levels are reached at 24 and 54 ticks — 0.40 s and 0.90 s, which is where the
 * upgraded build put them. Level 3 does not fire on its own; the hold is
 * open-ended, so committing to a full charge is a decision the opponent can see
 * and punish rather than a timer the game runs for you.
 *
 * Timings, damage and reach are the upgraded build's, unchanged. Knockback is
 * re-authored in this simulation's units for the reason given in fighterData.ts,
 * preserving the relative weights — 驚嚇衝撞's `120 < 190 < 280` is the clearest
 * case, and its ordering survives.
 *
 * The statuses some of these carried — `sticky`, `awkward` — are not read by the
 * simulation yet, so those moves are here without them.
 */

export interface ChargeSpecial {
  /** What the HUD calls the move, level aside. */
  displayName: string;
  /** Indexed by charge level minus one. */
  levels: [AttackSpec, AttackSpec, AttackSpec];
}

/** Ticks of hold that reach level 2 and level 3. */
export const CHARGE_LEVEL_2_TICKS = 24;
export const CHARGE_LEVEL_3_TICKS = 54;

/** Which level a hold of `ticks` has reached. */
export function chargeLevel(ticks: number): 1 | 2 | 3 {
  if (ticks < CHARGE_LEVEL_2_TICKS) return 1;
  if (ticks < CHARGE_LEVEL_3_TICKS) return 2;
  return 3;
}

/** What a level must state; everything else has a shared default below. */
type Level = Pick<AttackSpec, 'id' | 'name' | 'kind' | 'damage' | 'reach' | 'knockbackX'> &
  Partial<AttackSpec>;

/** The shared shape of a charge level; only the interesting fields are written. */
const level = (spec: Level): AttackSpec => ({
  startup: 7,
  active: 5,
  recovery: 18,
  hitstun: 16,
  blockstun: 9,
  knockbackY: -60,
  chipRatio: 0.1,
  energyOnHit: 6,
  energyOnReceive: 3,
  ...spec,
});

export const CHARGE_SPECIALS: Record<string, ChargeSpecial> = {
  alien: {
    displayName: '斷訊掃描波',
    levels: [
      level({ id: 'h-alien-1', name: '斷訊掃描波 Lv1', kind: 'beam', damage: 7, reach: 280, knockbackX: 167 }),
      level({ id: 'h-alien-2', name: '斷訊掃描波 Lv2', kind: 'beam', damage: 10, reach: 420, knockbackX: 182 }),
      level({ id: 'h-alien-3', name: '斷訊掃描波 Lv3', kind: 'beam', damage: 13, reach: 620, knockbackX: 201 }),
    ],
  },
  doge: {
    displayName: '肌肉衝撞',
    levels: [
      level({ id: 'h-doge-1', name: '肌肉衝撞 Lv1', kind: 'dashStrike', damage: 8, reach: 135, knockbackX: 192, startup: 5, active: 7 }),
      level({ id: 'h-doge-2', name: '肌肉衝撞 Lv2', kind: 'dashStrike', damage: 11, reach: 190, knockbackX: 221, startup: 5, active: 9, recovery: 20 }),
      level({
        id: 'h-doge-3', name: '肌肉衝撞 Lv3', kind: 'dashStrike', damage: 15, reach: 250, knockbackX: 257,
        startup: 5, active: 11, recovery: 22,
        // A full charge buys the approach one hit of armour, which is what makes
        // holding it worth the telegraph.
        armor: { against: 'strike', hits: 1, from: 6, to: 16 },
      }),
    ],
  },
  ya: {
    displayName: '尷尬招呼波',
    levels: [
      level({ id: 'h-ya-1', name: '尷尬招呼波 Lv1', kind: 'zone', damage: 2, reach: 90, knockbackX: 136, telegraph: 18, zoneDuration: 84 }),
      level({ id: 'h-ya-2', name: '尷尬招呼波 Lv2', kind: 'zone', damage: 3, reach: 150, knockbackX: 141, telegraph: 18, zoneDuration: 120 }),
      level({ id: 'h-ya-3', name: '尷尬招呼波 Lv3', kind: 'zone', damage: 4, reach: 230, knockbackX: 146, telegraph: 18, zoneDuration: 168 }),
    ],
  },
  tempura: {
    displayName: '企鵝衝隊',
    levels: [
      level({ id: 'h-tempura-1', name: '企鵝衝隊 Lv1', kind: 'dashStrike', damage: 7, reach: 150, knockbackX: 180, active: 7 }),
      level({ id: 'h-tempura-2', name: '企鵝衝隊 Lv2', kind: 'dashStrike', damage: 10, reach: 210, knockbackX: 203, active: 9 }),
      level({ id: 'h-tempura-3', name: '企鵝衝隊 Lv3', kind: 'dashStrike', damage: 13, reach: 285, knockbackX: 229, active: 11 }),
    ],
  },
  goblin: {
    displayName: '愛的擁抱',
    levels: [
      level({ id: 'h-goblin-1', name: '愛的擁抱 Lv1', kind: 'commandThrow', damage: 8, reach: 70, knockbackX: 175, recovery: 25, blockstun: 1, unblockable: true, hardKnockdown: true }),
      level({ id: 'h-goblin-2', name: '愛的擁抱 Lv2', kind: 'commandThrow', damage: 11, reach: 105, knockbackX: 188, recovery: 27, blockstun: 1, unblockable: true, hardKnockdown: true }),
      level({ id: 'h-goblin-3', name: '愛的擁抱 Lv3', kind: 'commandThrow', damage: 14, reach: 150, knockbackX: 201, recovery: 30, blockstun: 1, unblockable: true, hardKnockdown: true }),
    ],
  },
  salad: {
    displayName: '拒吃震波',
    levels: [
      // Almost no damage, enormous push: this is a positioning tool, not a hit.
      level({ id: 'h-salad-1', name: '拒吃震波 Lv1', kind: 'strike', damage: 3, reach: 100, knockbackX: 276 }),
      level({ id: 'h-salad-2', name: '拒吃震波 Lv2', kind: 'strike', damage: 4, reach: 130, knockbackX: 354 }),
      level({ id: 'h-salad-3', name: '拒吃震波 Lv3', kind: 'strike', damage: 5, reach: 165, knockbackX: 458 }),
    ],
  },
  wizard: {
    displayName: 'JPEG 魔法陣',
    levels: [
      level({ id: 'h-wizard-1', name: 'JPEG 魔法陣 Lv1', kind: 'zone', damage: 4, reach: 80, knockbackX: 143, telegraph: 20, zoneDuration: 48 }),
      level({ id: 'h-wizard-2', name: 'JPEG 魔法陣 Lv2', kind: 'zone', damage: 6, reach: 130, knockbackX: 149, telegraph: 20, zoneDuration: 72 }),
      level({ id: 'h-wizard-3', name: 'JPEG 魔法陣 Lv3', kind: 'zone', damage: 8, reach: 190, knockbackX: 156, telegraph: 20, zoneDuration: 108 }),
    ],
  },
  blade: {
    displayName: '鈍刀蓄斬',
    levels: [
      // The blockstun climbs with the level, so a full charge is safe even blocked.
      level({ id: 'h-blade-1', name: '鈍刀蓄斬 Lv1', kind: 'strike', damage: 8, reach: 120, knockbackX: 175, blockstun: 13 }),
      level({ id: 'h-blade-2', name: '鈍刀蓄斬 Lv2', kind: 'strike', damage: 12, reach: 165, knockbackX: 195, blockstun: 16 }),
      level({ id: 'h-blade-3', name: '鈍刀蓄斬 Lv3', kind: 'strike', damage: 17, reach: 220, knockbackX: 221, blockstun: 20 }),
    ],
  },
  pink: {
    displayName: '尖叫爆震',
    levels: [
      level({ id: 'h-pink-1', name: '尖叫爆震 Lv1', kind: 'beam', damage: 6, reach: 180, knockbackX: 185 }),
      level({ id: 'h-pink-2', name: '尖叫爆震 Lv2', kind: 'beam', damage: 9, reach: 270, knockbackX: 214 }),
      level({ id: 'h-pink-3', name: '尖叫爆震 Lv3', kind: 'beam', damage: 12, reach: 390, knockbackX: 250 }),
    ],
  },
  sauce: {
    displayName: '黏醬飛射',
    levels: [
      level({ id: 'h-sauce-1', name: '黏醬飛射 Lv1', kind: 'projectile', damage: 5, reach: 300, knockbackX: 151, projectileSpeed: 480, lifetime: 48 }),
      level({ id: 'h-sauce-2', name: '黏醬飛射 Lv2', kind: 'projectile', damage: 7, reach: 380, knockbackX: 162, projectileSpeed: 540, lifetime: 56 }),
      level({ id: 'h-sauce-3', name: '黏醬飛射 Lv3', kind: 'projectile', damage: 9, reach: 460, knockbackX: 172, projectileSpeed: 600, lifetime: 64 }),
    ],
  },
  scared: {
    displayName: '驚嚇衝撞',
    levels: [
      // The knockback ladder the upgraded build's own QA asserts: 120 < 190 < 280
      // in its units, and still strictly increasing in ours.
      level({ id: 'h-scared-1', name: '驚嚇衝撞 Lv1', kind: 'dashStrike', damage: 6, reach: 120, knockbackX: 276, startup: 4, active: 7, recovery: 17 }),
      level({ id: 'h-scared-2', name: '驚嚇衝撞 Lv2', kind: 'dashStrike', damage: 8, reach: 180, knockbackX: 367, startup: 4, active: 10, recovery: 19 }),
      level({ id: 'h-scared-3', name: '驚嚇衝撞 Lv3', kind: 'dashStrike', damage: 10, reach: 250, knockbackX: 484, startup: 4, active: 13, recovery: 22 }),
    ],
  },
  ok: {
    displayName: 'OK 判決波',
    levels: [
      level({ id: 'h-ok-1', name: 'OK 判決波 Lv1', kind: 'beam', damage: 6, reach: 260, knockbackX: 164, hitstun: 15 }),
      level({ id: 'h-ok-2', name: 'OK 判決波 Lv2', kind: 'beam', damage: 8, reach: 360, knockbackX: 180, hitstun: 19 }),
      level({ id: 'h-ok-3', name: 'OK 判決波 Lv3', kind: 'beam', damage: 10, reach: 500, knockbackX: 198, hitstun: 26, blockstun: 18 }),
    ],
  },
};

export function chargeSpecialFor(fighterId: string): ChargeSpecial {
  const found = CHARGE_SPECIALS[fighterId];
  if (!found) throw new Error(`No chargeable special for fighter: ${fighterId}`);
  return found;
}

/** Every charge level on the roster, for registration and for tests. */
export function allChargeLevels(): AttackSpec[] {
  return Object.values(CHARGE_SPECIALS).flatMap((entry) => entry.levels);
}
