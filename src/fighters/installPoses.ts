import type { PoseName } from './poseSheet';

/**
 * What a transformed fighter looks like, pose by pose.
 *
 * Four ultimates are transformations: doge's muscles, goblin's ten years of an
 * elder's life, blade throwing the shield away, and pink's mask coming off. Each
 * was drawn a second time on its skill sheet — a full set of poses in the new
 * body — and until now none of them reached the screen. The install rendered as
 * `sprite.setTint(accent)`, which is to say the fighter turned a colour for eight
 * seconds.
 *
 * ### Why this table is not the upgraded build's
 *
 * The upgraded build carries the same idea as an array per fighter, indexed by
 * state. Every one of those arrays is off by a place or two, and always in the
 * same direction: it starts at an effect layer rather than at the first pose. Its
 * doge idles as `I`, a golden silhouette exploding; its goblin idles as `J`, a
 * clock dissolving; its pink idles as `K`, a magenta burst. Ported faithfully,
 * standing still after a transformation shows an explosion that never ends.
 *
 * So the mapping here is read off the art instead — see
 * `audit/skill-assets/contact_sheets/` — and the effect layers those arrays
 * started on are used where they belong, on the moment of change, in
 * `ultimateVisuals.ts`. `src/render/__tests__/fighterArt.test.ts` pins the
 * corrections so a later "port it faithfully" pass cannot quietly undo them.
 *
 * A pose with no entry falls back to the fighter's ordinary sheet: doge has no
 * transformed guard drawing, and a missing key would render as a green box.
 *
 * Every table names an `ultimate` pose even though a transformed fighter has no
 * meter left to spend. The two states overlap: an install lands at its timeline's
 * peak — tick 54 for doge — and the `ULTIMATE` state runs to tick 64, so for ten
 * ticks the fighter is transformed and still mid-ultimate. It stands there in the
 * new body, which is the moment the whole transformation is for.
 */

/** The transformed drawings, by pose. Cells are letters on the skill sheet. */
export type InstallPoseTable = Partial<Record<PoseName, string>>;

export const INSTALL_POSES: Record<string, InstallPoseTable> = {
  /** J idle, K/L the stride, M on all fours, N leaping, O jab, P spin, Q reeling, R out. */
  doge: {
    idle: 'J',
    walkForward: 'K',
    walkBack: 'L',
    dashForward: 'K',
    dashBack: 'L',
    crouch: 'M',
    crouchLight: 'M',
    crouchHeavy: 'M',
    jump: 'N',
    jumpLight: 'N',
    jumpHeavy: 'N',
    light: 'O',
    heavy: 'P',
    special: 'O',
    throw: 'O',
    hit: 'Q',
    ko: 'R',
    victory: 'J',
    ultimate: 'J',
  },

  /** L idle, M/N walking, O crouched, P leaping, Q jab, R heart swing, S guarding, T hit, U out. */
  goblin: {
    idle: 'L',
    walkForward: 'M',
    walkBack: 'N',
    dashForward: 'M',
    dashBack: 'N',
    crouch: 'O',
    crouchLight: 'O',
    crouchHeavy: 'O',
    jump: 'P',
    jumpLight: 'P',
    jumpHeavy: 'P',
    light: 'Q',
    heavy: 'R',
    special: 'R',
    throw: 'Q',
    block: 'S',
    hit: 'T',
    ko: 'U',
    victory: 'L',
    ultimate: 'L',
  },

  /** L dual-wield idle, M the dash, N the spin, O the slam, P planted, Q out cold. */
  blade: {
    idle: 'L',
    walkForward: 'M',
    walkBack: 'M',
    dashForward: 'M',
    dashBack: 'M',
    light: 'N',
    heavy: 'O',
    special: 'O',
    throw: 'N',
    crouchLight: 'N',
    crouchHeavy: 'O',
    block: 'P',
    hit: 'P',
    ko: 'Q',
    victory: 'L',
    ultimate: 'L',
  },

  /** L idle, M/N walking, O braced, P leaping, Q palm, R slam, S seeing stars, T flat, U guard. */
  pink: {
    idle: 'L',
    walkForward: 'M',
    walkBack: 'N',
    dashForward: 'M',
    dashBack: 'N',
    crouch: 'O',
    crouchLight: 'O',
    crouchHeavy: 'O',
    jump: 'P',
    jumpLight: 'P',
    jumpHeavy: 'P',
    light: 'Q',
    heavy: 'R',
    special: 'R',
    throw: 'Q',
    block: 'U',
    hit: 'S',
    ko: 'T',
    victory: 'L',
    ultimate: 'L',
  },
};

/**
 * The two swords blade carries once the shield is gone.
 *
 * They are separate textures rather than part of the transformed poses because
 * the pipeline split them out of one cell for exactly this: the delivered notes
 * say they mount on a left and a right socket, and that no third sword is
 * generated. The cell they came from, `blade/K`, is therefore never drawn — it is
 * both swords in one image, and drawing it alongside these two would put three on
 * screen.
 */
export const INSTALL_ATTACHMENTS: Record<string, readonly string[]> = {
  blade: ['K_weapon_blue', 'K_weapon_black'],
};

/** The transformed cell for a pose, or null to fall back to the pose sheet. */
export function installCellFor(fighterId: string, pose: PoseName): string | null {
  return INSTALL_POSES[fighterId]?.[pose] ?? null;
}
