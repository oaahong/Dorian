/**
 * Gameplay constants, at tick resolution.
 *
 * This is the single source of truth; `src/utils/constants.ts` re-exports these
 * for the Phaser code that has not been migrated yet, and keeps only the purely
 * cosmetic values (colours, fonts) of its own.
 *
 * Nothing here may call a transcendental function at runtime — see
 * STUN_FRICTION_PER_TICK for why.
 */

// --- Time -------------------------------------------------------------------

export const TICK_HZ = 60;

/** Wall-clock milliseconds one tick represents. Only the render loop's accumulator uses this. */
export const TICK_MS = 1000 / TICK_HZ;

/**
 * Seconds per tick, as a **constant**. The old code passed a measured frame delta
 * into the physics, so a 60 Hz and a 144 Hz client computed different positions
 * from the same inputs. Everything in the simulation now integrates against this.
 */
export const DT = 1 / TICK_HZ;

/** Convert an authored millisecond duration to whole ticks. */
export const msToTicks = (ms: number): number => Math.round((ms * TICK_HZ) / 1000);

// --- Arena ------------------------------------------------------------------

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
export const GROUND_Y = 610;
export const ARENA_MIN_X = 95;
export const ARENA_MAX_X = 1185;

export const FIGHTER_HURTBOX_WIDTH = 104;
export const FIGHTER_HURTBOX_HEIGHT = 194;

/** Crouching shortens the hurtbox to this fraction of its standing height. */
export const CROUCH_HURTBOX_SCALE = 0.66;

/**
 * How much larger an installed fighter's body is than its normal one.
 *
 * The upgraded build's delivered notes fix this at 2.0x with the feet baseline
 * unchanged, and say the hurtbox is re-fitted to the body rather than left at the
 * untransformed size. That is the trade the transformation makes: the four
 * fighters who get one hit harder for eight seconds and are easier to hit for the
 * same eight seconds.
 *
 * Multiplication, deliberately, and not rounding. `FIGHTER_HURTBOX_HEIGHT *
 * CROUCH_HURTBOX_SCALE` is already a non-integer (194 x 0.66), and both clients
 * evaluate the same IEEE-754 operations in the same order on the same inputs, so
 * they agree bit for bit. Introducing a `Math.round` here would not make it
 * "safer" — it would change the boxes, and it would need the golden replays
 * rerecorded to say so.
 */
export const INSTALL_BODY_SCALE = 2;

/** Minimum horizontal separation enforced between two grounded fighters. */
export const PUSH_APART_DISTANCE = 86;

/** Spawn positions, reapplied at the start of every round. */
export const P1_SPAWN_X = 350;
export const P2_SPAWN_X = 930;

// --- Physics ----------------------------------------------------------------

export const GRAVITY = 1750;
export const JUMP_VELOCITY = -690;

/** Horizontal control while airborne, as a fraction of ground speed. */
export const AIR_CONTROL_SCALE = 0.75;

/**
 * Per-tick velocity decay while in hitstun, blockstun or KO.
 *
 * The original expression was `vx *= Math.pow(0.0015, dt)` with a variable `dt`.
 * `Math.pow` is not required to be bit-identical across JavaScript engines, so it
 * cannot run inside the simulation. With a fixed timestep the exponent is
 * constant, so the whole call collapses to this literal — verified against
 * `Math.pow(0.0015, 1 / 60)` in constants.test.ts.
 */
export const STUN_FRICTION_PER_TICK = 0.89729418715708964;

/** Attacks whose active frames drag the fighter forward, in px/s. */
export const DASH_ATTACK_SPEED = 590;
export const SLIDE_ATTACK_SPEED = 670;
export const HEAVY_ATTACK_DRIFT = 105;

// --- Round flow -------------------------------------------------------------

export const ROUND_TIME_MS = 60_000;
export const ROUND_TICKS = msToTicks(ROUND_TIME_MS); // 3600

/** "CAT FIGHT!" appears here, and control is handed over at INTRO_TICKS. */
export const ROUND_CALL_TICKS = msToTicks(620); // 37
export const INTRO_TICKS = msToTicks(1120); // 67
export const ENDING_TICKS = msToTicks(2350); // 141

/** Rounds needed to take the match. */
export const ROUNDS_TO_WIN = 2;

// --- Input ------------------------------------------------------------------

export const INPUT_BUFFER_MS = 140;
/** How long a crouch press keeps counting toward the ultimate motion. */
export const INPUT_BUFFER_TICKS = msToTicks(INPUT_BUFFER_MS); // 8

/** Holding away from the opponent only enters the BLOCK stance within this range. */
export const BLOCK_STANCE_RANGE = 340;

// --- Stat tables ------------------------------------------------------------

export const SPEED_BY_STAT: Record<number, number> = {
  1: 235,
  2: 255,
  3: 280,
  4: 310,
  5: 340,
};

/**
 * Dashes.
 *
 * Ten ticks, matching the upgraded build. The speeds are its per-frame figures
 * (9.2 and 8.2 pixels a frame) expressed in this simulation's pixels-per-second,
 * so a dash covers the same ground here as it does there. A dash is roughly twice
 * a walk, which is what makes it worth the commitment.
 *
 * The speed stat scales dashes far more gently than it scales walking — a fast
 * fighter walks 45% quicker than a slow one, but dashes only 12% quicker.
 * Movement stats belong on the movement you can react to; a dash that also
 * out-ranged everyone else's would make the stat decide the neutral game on its
 * own.
 */
export const DASH_TICKS = 10;
export const DASH_SPEED = 552;
export const BACK_DASH_SPEED = 492;
export const DASH_SPEED_BY_STAT = (stat: number): number => 0.94 + stat * 0.03;

/**
 * Damage scaling down a combo: full, then 90%, 80%, 70%, 60%, and 50% from the
 * sixth hit on.
 *
 * The reason a combo system needs this at all is that cancels removed the
 * opponent's turn — without scaling, "can I link these" and "how much is the
 * round worth" become the same question, and the longest string wins outright.
 * Ultimates floor at 50% however deep they land, because a super that is worth
 * nothing as a finisher is a super nobody finishes with.
 */
const COMBO_SCALE = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
export const COMBO_SCALING = (hits: number): number =>
  COMBO_SCALE[Math.min(Math.max(hits, 1), COMBO_SCALE.length) - 1]!;

/** How long a combo survives without a new hit before it lapses. */
export const COMBO_WINDOW_TICKS = 50;

/** Meter gained per tick for holding the ultimate button: five a second. */
export const ULTIMATE_CHARGE_PER_TICK = 5 / TICK_HZ;

/**
 * How recently the victim must have reached for a throw to escape one.
 *
 * Five ticks — eighty milliseconds. Long enough that both players pressing at
 * roughly the same moment counts as a contest rather than a coin flip, short
 * enough that holding the button is not an answer to being thrown.
 */
export const THROW_TECH_TICKS = 5;

export const ATTACK_MULTIPLIER = (stat: number): number => 0.85 + stat * 0.07;
export const RANGE_MULTIPLIER = (stat: number): number => 0.88 + stat * 0.055;
export const CONTROL_RECOVERY_MULTIPLIER = (stat: number): number => 1.05 - stat * 0.025;

/**
 * Special cooldowns use a different control scale from attack recovery — 1.08
 * rather than 1.05. The split is in the original code and is preserved
 * deliberately; it is not a typo to normalise away.
 */
export const CONTROL_COOLDOWN_MULTIPLIER = (stat: number): number => 1.08 - stat * 0.025;

/** Damage taken is scaled by the defender's HP stat. */
export const HP_STAT_MITIGATION = (stat: number): number => 1.08 - stat * 0.03;

/**
 * What an install is worth: a quarter more damage for as long as it lasts.
 *
 * Deliberately damage rather than speed or frame data. A buff that changed timings
 * would mean every matchup had two sets of frames to learn, and the fighters that
 * get an install are the ones whose problem is closing a round, not moving.
 */
export const INSTALL_DAMAGE_MULTIPLIER = 1.25;

/** How much a sticky or awkward hit slows the walk it leaves behind. */
export const SLOW_MOVE_MULTIPLIER = 0.7;

export const MAX_HP = 100;
export const MAX_ENERGY = 100;

/** Default cooldown for a special that does not declare one. Was 1500 ms. */
export const DEFAULT_SPECIAL_COOLDOWN_TICKS = 90;
/** Default stun lock-out for an `aura` attack that does not declare one. Was 2800 ms. */
export const DEFAULT_STUN_LOCKOUT_TICKS = 168;
