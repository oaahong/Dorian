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

export const MAX_HP = 100;
export const MAX_ENERGY = 100;

/** Default cooldown for a special that does not declare one. Was 1500 ms. */
export const DEFAULT_SPECIAL_COOLDOWN_TICKS = 90;
/** Default stun lock-out for an `aura` attack that does not declare one. Was 2800 ms. */
export const DEFAULT_STUN_LOCKOUT_TICKS = 168;
