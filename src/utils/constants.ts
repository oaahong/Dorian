export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
export const GROUND_Y = 610;
export const ARENA_MIN_X = 95;
export const ARENA_MAX_X = 1185;
export const ROUND_TIME_MS = 60_000;
export const GRAVITY = 1750;
export const JUMP_VELOCITY = -690;
export const INPUT_BUFFER_MS = 140;
export const FIGHTER_HURTBOX_WIDTH = 104;
export const FIGHTER_HURTBOX_HEIGHT = 194;

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

export const SPEED_BY_STAT: Record<number, number> = {
  1: 235,
  2: 255,
  3: 280,
  4: 310,
  5: 340,
};

export const ATTACK_MULTIPLIER = (stat: number) => 0.85 + stat * 0.07;
export const RANGE_MULTIPLIER = (stat: number) => 0.88 + stat * 0.055;
export const CONTROL_RECOVERY_MULTIPLIER = (stat: number) => 1.05 - stat * 0.025;
