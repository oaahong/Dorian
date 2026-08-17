export enum FighterState {
  IDLE = 'IDLE',
  WALK = 'WALK',
  CROUCH = 'CROUCH',
  JUMP = 'JUMP',
  LIGHT_ATTACK = 'LIGHT_ATTACK',
  HEAVY_ATTACK = 'HEAVY_ATTACK',
  SPECIAL = 'SPECIAL',
  ULTIMATE = 'ULTIMATE',
  THROW = 'THROW',
  /** Winding up the bare-button special. Not an attack: nothing can be hit yet. */
  H_CHARGING = 'H_CHARGING',
  BLOCK = 'BLOCK',
  BLOCKSTUN = 'BLOCKSTUN',
  HITSTUN = 'HITSTUN',
  KO = 'KO',
  VICTORY = 'VICTORY',
}
