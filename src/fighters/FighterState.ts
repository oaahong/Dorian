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
  /**
   * The three universal meme moves and the two dashes.
   *
   * Separate states rather than reusing LIGHT_ATTACK and friends, because the view
   * has a distinct frame for each and because `isAttacking` has to answer
   * differently for them: a parry is not an attack, and a dash is not a move at
   * all — it is movement the fighter is committed to.
   */
  MEME_IMPACT = 'MEME_IMPACT',
  MEME_PARRY = 'MEME_PARRY',
  MEME_RUSH = 'MEME_RUSH',
  DASH_FORWARD = 'DASH_FORWARD',
  DASH_BACK = 'DASH_BACK',
  /** Winding up the bare-button special. Not an attack: nothing can be hit yet. */
  H_CHARGING = 'H_CHARGING',
  BLOCK = 'BLOCK',
  BLOCKSTUN = 'BLOCKSTUN',
  HITSTUN = 'HITSTUN',
  KO = 'KO',
  VICTORY = 'VICTORY',
}
