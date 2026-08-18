import type { VisualBeat } from '../fighters/ultimateVisuals';

/**
 * Which beats of an ultimate's visual script are due, and when.
 *
 * Pure on purpose. The interesting part of playing a scripted ultimate is not the
 * drawing, it is the arithmetic: the script is written in simulation ticks, and
 * the renderer runs once per *frame*. Those are not the same clock. The
 * fixed-step accumulator runs several ticks in one frame whenever the client is
 * behind — a long paint, a background tab, a slow first load — so a frame can
 * advance an ultimate from tick 8 to tick 11 in one call.
 *
 * Matching beats on equality (`if (tick === beat.atTick)`) therefore silently
 * drops them, and drops them *only on slow machines*, which is the worst kind of
 * bug this file could have: it looks perfect on the machine it was written on.
 * `beatsBetween` takes the half-open interval the frame actually covered and
 * returns everything inside it. `UltimateCutIn` carries the same lesson in prose;
 * this is the same lesson as code.
 */

/** One occurrence of a beat, with its repeat expanded and its tick resolved. */
export interface ScheduledBeat extends VisualBeat {
  /** The tick this occurrence fires on. */
  tick: number;
  /** Unique within a script, so the shell can key a sprite on it. */
  id: string;
}

/**
 * The most occurrences any one beat may expand into.
 *
 * Every occurrence becomes a live Phaser object, so an unbounded repeat is an
 * unbounded object count. Beats carry their own `max`; this is the backstop for a
 * `max` that was written carelessly, and it is deliberately generous enough that
 * no honest script reaches it.
 */
export const REPEAT_HARD_CAP = 32;

/**
 * Expand every repeat into explicit occurrences, in play order.
 *
 * Done once when the stage is created rather than per frame: a script is at most a
 * few dozen beats, and doing it up front means `beatsBetween` is a filter over a
 * flat list instead of arithmetic repeated sixty times a second.
 */
export function expandBeats(script: readonly VisualBeat[]): ScheduledBeat[] {
  const expanded: ScheduledBeat[] = [];

  script.forEach((beat, index) => {
    const repeat = beat.repeat;
    // A zero or negative interval would loop forever. Treating it as a one-shot is
    // the reading that cannot hang, and the script that meant a one-shot simply
    // would not have written a `repeat`.
    if (!repeat || repeat.everyTicks <= 0) {
      expanded.push({ ...beat, tick: beat.atTick, id: `${index}:0` });
      return;
    }

    const limit = Math.min(repeat.max, REPEAT_HARD_CAP);
    let occurrence = 0;
    for (let tick = beat.atTick; tick <= repeat.untilTick && occurrence < limit; tick += repeat.everyTicks) {
      expanded.push({ ...beat, tick, id: `${index}:${occurrence}` });
      occurrence += 1;
    }
  });

  // Stable by tick, then by the order the script wrote them: two beats on the same
  // tick are a deliberate layering — the flash behind the sprite, not in front.
  return expanded
    .map((beat, order) => ({ beat, order }))
    .sort((a, b) => a.beat.tick - b.beat.tick || a.order - b.order)
    .map(({ beat }) => beat);
}

/**
 * The beats due in `(fromExclusive, toInclusive]`.
 *
 * Half-open at the bottom so consecutive frames never replay the boundary tick:
 * a caller passes the tick it last played, and gets back everything since.
 */
export function beatsBetween(
  script: readonly VisualBeat[] | readonly ScheduledBeat[],
  fromExclusive: number,
  toInclusive: number,
): ScheduledBeat[] {
  const beats = isExpanded(script) ? script : expandBeats(script);
  return beats.filter((beat) => beat.tick > fromExclusive && beat.tick <= toInclusive);
}

/** Already-expanded scripts are passed straight through, so a stage expands once. */
function isExpanded(
  script: readonly VisualBeat[] | readonly ScheduledBeat[],
): script is readonly ScheduledBeat[] {
  return script.length === 0 || 'tick' in script[0]!;
}
