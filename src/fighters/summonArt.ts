import type { SimSummon } from '../sim/types';
import { ultimateTimelineFor } from './ultimateTimelines';

/**
 * What a companion looks like while it is on the field.
 *
 * Two ultimates leave something behind, and both were drawn properly: tempura's
 * nine clones have five different faces between them, and scared's husky has a
 * stand, a walk, a lunge, a bite, two idle mugs, a flinch and a dissolve. Fourteen
 * images in all, and the renderer drew one of them — a single texture per
 * fighter, held for the whole ten seconds, whatever the companion was doing.
 *
 * That is not only a missed picture either. A husky that never changes pose gives
 * the player no read on whether it is about to bite, and a wall of nine identical
 * penguins reads as a texture rather than as nine things that can each be knocked
 * down.
 *
 * Which cell is showing is derived from simulation state — position, cooldown,
 * hit points, formation slot — so it stays a pure function of the world and this
 * file stays testable without a browser.
 */

export interface SummonArt {
  /** Standing still, and the fallback for anything not otherwise named. */
  idle: string;
  /** Closing the distance. */
  walk?: string;
  /** Wound up, about to connect. */
  windup?: string;
  /** Mid-swing. */
  attack?: string;
  /** Looking pleased with itself, just after connecting. */
  taunt?: string;
  /** Mocking a target that has put distance between them. */
  gloat?: string;
  /** Just been hit, with hit points left. */
  hurt?: string;
  /** On its way out, whether killed or expired. */
  despawn?: string;
  /** Drawn where its attack connects. */
  impact?: string;
  /**
   * One look per formation slot, cycled.
   *
   * Clones only: nine of the same fighter should not be nine copies of one
   * drawing, and the sheet has five faces for exactly this.
   */
  variants?: readonly string[];
}

export const SUMMON_ART: Record<string, SummonArt> = {
  /** Nine penguins with five faces between them, and a puff when one goes down. */
  tempura: {
    idle: 'I',
    variants: ['I', 'J', 'K', 'L', 'N'],
    despawn: 'O',
  },

  /** A husky that stands, runs, leaps, bites, gloats, flinches and dissolves. */
  scared: {
    idle: 'L',
    walk: 'M',
    windup: 'N',
    attack: 'O',
    taunt: 'Q',
    gloat: 'P',
    hurt: 'R',
    despawn: 'S',
    impact: 'T',
  },
};

export function summonArtFor(fighterId: string): SummonArt | null {
  return SUMMON_ART[fighterId] ?? null;
}

/**
 * Which cell a companion is showing this tick.
 *
 * Read off the simulation rather than tracked here, for the same reason the
 * fighters' poses are: a view that remembers what it drew last is a second copy
 * of the game state, and the two drift.
 *
 * `hurtTicks` is how recently it was hit, which the simulation does not record —
 * companions have hit points but no hitstun — so the caller passes what it saw.
 */
export function summonCellFor(
  art: SummonArt,
  summon: SimSummon,
  fighterId: string,
  options: { hurt: boolean; distanceToTarget: number },
): string {
  if (options.hurt && art.hurt) return art.hurt;

  const timeline = ultimateTimelineFor(fighterId);
  const rehit = timeline.summon?.rehitTicks ?? 0;
  const reach = timeline.summon?.chase?.reach ?? 0;

  // The swing, then the wind-up, read backwards off the cooldown: a companion
  // that has just connected is mid-swing, and one whose cooldown is nearly up is
  // about to be.
  if (rehit > 0 && art.attack && summon.cooldownTicks > rehit - ATTACK_TICKS) return art.attack;
  if (art.windup && summon.cooldownTicks <= WINDUP_TICKS && options.distanceToTarget <= reach) {
    return art.windup;
  }
  // Out of reach with the bite still cooling: it has been left behind, and says
  // so, rather than trudging after them in the walk pose the whole time.
  if (art.gloat && options.distanceToTarget > reach && rehit > 0 && summon.cooldownTicks > rehit / 2) {
    return art.gloat;
  }
  if (art.walk && options.distanceToTarget > reach) return art.walk;
  if (art.taunt && rehit > 0 && summon.cooldownTicks > rehit / 2) return art.taunt;

  // Clones hold a formation rather than chasing, so what varies between them is
  // which of them it is, not what it is doing.
  if (art.variants?.length) return art.variants[summon.slot % art.variants.length]!;

  return art.idle;
}

/** How long after connecting a companion is still drawn mid-swing. */
const ATTACK_TICKS = 8;
/** How close to ready it has to be before it visibly winds up. */
const WINDUP_TICKS = 10;
