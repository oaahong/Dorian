/**
 * Presentation constants, plus a re-export of the gameplay constants.
 *
 * Gameplay values now live in `src/sim/constants.ts` so that the simulation has
 * no dependency on anything under `src/utils`. They are re-exported here so the
 * Phaser code that has not been migrated yet keeps compiling against its original
 * import path; new code in `src/sim` and `src/render` should import from
 * `src/sim/constants` directly.
 */

export {
  ARENA_MAX_X,
  ARENA_MIN_X,
  ATTACK_MULTIPLIER,
  CONTROL_RECOVERY_MULTIPLIER,
  FIGHTER_HURTBOX_HEIGHT,
  FIGHTER_HURTBOX_WIDTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  GRAVITY,
  GROUND_Y,
  INPUT_BUFFER_MS,
  JUMP_VELOCITY,
  RANGE_MULTIPLIER,
  ROUND_TIME_MS,
  SPEED_BY_STAT,
} from '../sim/constants';

export const COLORS = {
  bg: 0x050505,
  panel: 0x090909,
  gold: 0xe9b928,
  cream: 0xf3e9d0,
  red: 0xff3b30,
  cyan: 0x00c8ff,
  purple: 0xa338ff,
  green: 0x7cff00,
  orange: 0xff8a1f,
  white: 0xffffff,
  darkPurple: 0x180824,
};

export const FONT_FAMILY = '"Arial Black", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
