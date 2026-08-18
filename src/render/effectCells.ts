import { chargeSpecialFor } from '../fighters/chargeSpecials';
import { FIGHTERS } from '../fighters/fighterData';

/**
 * The art a charge special is made of, by level.
 *
 * Three cells per fighter, filed by the asset pipeline as `H_OR_SHARED_VFX`, and
 * they are the same move at its three strengths — alien's beam thickens, blade's
 * sword lengthens, salad's shockwave widens, scared's portal opens. Thirty-six
 * images, none of which had ever been drawn: the charge special rendered as a
 * coloured rectangle whatever the player held for.
 *
 * That is not only a missed picture. The whole point of a chargeable move is that
 * the opponent can see what is coming, and until now the only tell was how long
 * the wind-up lasted.
 *
 * The mapping is positional — `E`, `F`, `G` in level order — because the sheets
 * are grids and the pipeline names cells by position. A fighter whose sheet ever
 * departs from that gets an entry in `EXCEPTIONS`; none does today, and inventing
 * a per-fighter table for a rule with no exceptions would be twelve lines saying
 * the same thing.
 */

const LEVEL_CELLS = ['E', 'F', 'G'] as const;

/** Where a fighter's charge art is somewhere other than E/F/G. */
const EXCEPTIONS: Record<string, readonly [string, string, string]> = {};

/** The cell a charge level's effect is drawn from. */
export function effectCellFor(fighterId: string, level: 1 | 2 | 3): string {
  return (EXCEPTIONS[fighterId] ?? LEVEL_CELLS)[level - 1]!;
}

/**
 * Charge spec id to its effect texture, or null for anything else.
 *
 * Null rather than a fallback: a motion special is a different move with its own
 * look, and giving it the charge special's art would be a picture of a move the
 * player did not do. Those keep the shapes they already draw.
 */
export function effectTextureFor(specId: string): string | null {
  const found = SPEC_TEXTURES.get(specId);
  return found ?? null;
}

/**
 * Whether the effect has to be drawn at the fighter, because nothing else will.
 *
 * Six of the twelve charge specials put an entity into the world — a beam, a
 * projectile, a zone — and their art rides on it. The other six are melee: doge
 * charges, goblin grabs, blade swings, salad shoves. They spawn nothing, so
 * without a flash at the fighter their three cells are drawn exactly never, which
 * is the state all thirty-six of them were in before this.
 */
export function needsReleaseFlash(specId: string): boolean {
  return MELEE_CHARGE_SPECS.has(specId);
}

/** Charge specials whose kind puts nothing into the world to hang art on. */
const ENTITY_KINDS = new Set(['beam', 'projectile', 'zone']);

const MELEE_CHARGE_SPECS = new Set(
  FIGHTERS.flatMap((fighter) =>
    chargeSpecialFor(fighter.id)
      .levels.filter((spec) => !ENTITY_KINDS.has(spec.kind))
      .map((spec) => spec.id),
  ),
);

/**
 * Built once from the frame data rather than by parsing the id.
 *
 * `h-alien-2` is readable enough that splitting it on dashes is tempting, and it
 * would work right up until a fighter's id contains one.
 */
const SPEC_TEXTURES = new Map<string, string>(
  FIGHTERS.flatMap((fighter) =>
    chargeSpecialFor(fighter.id).levels.map((spec, index): [string, string] => [
      spec.id,
      `skill-${fighter.id}-${effectCellFor(fighter.id, (index + 1) as 1 | 2 | 3).toLowerCase()}`,
    ]),
  ),
);
