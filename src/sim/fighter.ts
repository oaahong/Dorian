import { getFighterConfig } from '../fighters/fighterData';
import type { FighterConfig } from '../fighters/FighterConfig';
import { FighterState } from '../fighters/FighterState';
import {
  getSpec,
  HEAVY_SPEC,
  IMPACT_SPEC,
  NORMALS,
  PARRY_SPEC,
  RUSH_SPEC,
  THROW_SPEC,
  type TickSpec,
} from './attackSpecs';
import {
  AIR_CONTROL_SCALE,
  ARENA_MAX_X,
  ARENA_MIN_X,
  BLOCK_STANCE_RANGE,
  CONTROL_COOLDOWN_MULTIPLIER,
  CONTROL_RECOVERY_MULTIPLIER,
  BACK_DASH_SPEED,
  DASH_ATTACK_SPEED,
  DASH_SPEED,
  DASH_SPEED_BY_STAT,
  DASH_TICKS,
  DT,
  GRAVITY,
  GROUND_Y,
  HEAVY_ATTACK_DRIFT,
  INPUT_BUFFER_TICKS,
  JUMP_VELOCITY,
  MAX_ENERGY,
  MAX_HP,
  SLIDE_ATTACK_SPEED,
  SLOW_MOVE_MULTIPLIER,
  SPEED_BY_STAT,
  STUN_FRICTION_PER_TICK,
} from './constants';
import type { AttackSpec, CancelRule } from '../combat/AttackSpec';
import { CHARGE_LEVEL_3_TICKS, chargeLevel, chargeSpecialFor } from '../fighters/chargeSpecials';
import {
  DRAGON_PUNCH,
  QUARTER_CIRCLE_BACK,
  QUARTER_CIRCLE_FORWARD,
  CHORD_LENIENCY,
  createCommandHistory,
  matchesChord,
  matchesDoubleTap,
  matchesMotion,
  recordInput,
  resetCommandHistory,
} from './command';
import { BUTTON, EMPTY_INPUT, isDown, justPressed, moveAxis, type InputFrame } from './input';
import type { MoveResult, PlayerIndex, SimEvent, SimFighter } from './types';

/**
 * Per-fighter simulation. Ported from `src/fighters/Fighter.ts` with the Phaser
 * sprite, tweens and audio calls stripped out — see docs/sim-spec.md §3-4.
 *
 * Functions mutate the fighter in place rather than returning a new object: this
 * runs 60 times a second and, once rollback lands, several times per frame.
 */

export function createFighter(configId: string, x: number, facing: 1 | -1): SimFighter {
  return {
    configId,
    state: FighterState.IDLE,
    hp: MAX_HP,
    energy: 0,
    x,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    facing,
    stateRemainingTicks: 0,
    attack: null,
    nextSpecialTick: 0,
    stunLockoutUntilTick: 0,
    guardHeld: false,
    guardCrouching: false,
    prevButtons: 0,
    commandHistory: createCommandHistory(),
    /**
     * -1, not 0: the check is `tick <= downBufferedUntilTick`, so a zero here
     * makes the crouch buffer read as already open on tick 0 and a bare special
     * press on the very first tick register as the ultimate motion. Unreachable in
     * a real match, which starts in the intro phase with input disabled, but wrong
     * in the same way wherever it is reached.
     */
    downBufferedUntilTick: -1,
    dashTicks: 0,
    nextParryTick: 0,
    chargeTicks: 0,
    installTicks: 0,
    slowTicks: 0,
  };
}

/** Return a fighter to its round-start state, in place. */
export function resetFighter(fighter: SimFighter, x: number, facing: 1 | -1): void {
  fighter.state = FighterState.IDLE;
  fighter.hp = MAX_HP;
  fighter.energy = 0;
  fighter.x = x;
  fighter.y = GROUND_Y;
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.facing = facing;
  fighter.stateRemainingTicks = 0;
  fighter.attack = null;
  fighter.nextSpecialTick = 0;
  fighter.stunLockoutUntilTick = 0;
  fighter.guardHeld = false;
  fighter.guardCrouching = false;
  fighter.prevButtons = 0;
  resetCommandHistory(fighter.commandHistory);
  fighter.downBufferedUntilTick = -1;
  fighter.dashTicks = 0;
  fighter.nextParryTick = 0;
  fighter.chargeTicks = 0;
  fighter.installTicks = 0;
  fighter.slowTicks = 0;
}

/**
 * A one-pixel tolerance below the ground plane still counts as grounded. Landing
 * leaves sub-pixel residuals, and without the tolerance a fighter flickers
 * between grounded and airborne on the frame it touches down.
 */
export function isAirborne(fighter: SimFighter): boolean {
  return fighter.y < GROUND_Y - 1;
}

export function isKO(fighter: SimFighter): boolean {
  return fighter.state === FighterState.KO;
}

/**
 * States in which the fighter is committed to swinging at someone.
 *
 * MEME_PARRY is deliberately absent even though it holds a `SimAttack`: it has no
 * hitbox and its whole job is defensive, so counting it here would make a
 * parrying fighter unable to block on the frames after their invulnerability ran
 * out — punishing them twice for the same read. MEME_RUSH is absent for the
 * mirror-image reason: it is movement wearing an attack's clothes.
 */
export function isAttacking(fighter: SimFighter): boolean {
  return (
    fighter.state === FighterState.LIGHT_ATTACK ||
    fighter.state === FighterState.HEAVY_ATTACK ||
    fighter.state === FighterState.SPECIAL ||
    fighter.state === FighterState.ULTIMATE ||
    fighter.state === FighterState.THROW ||
    fighter.state === FighterState.MEME_IMPACT
  );
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * One tick of movement integration.
 *
 * Order matters and is ported verbatim: gravity, then `y`, then `x`. The
 * `vy < 0` term is what lets the first tick of a jump lift off, before `y` has
 * moved far enough for `isAirborne` to be true.
 */
export function stepPhysics(fighter: SimFighter): void {
  if (isAirborne(fighter) || fighter.vy < 0) {
    fighter.vy += GRAVITY * DT;
    fighter.y += fighter.vy * DT;
    fighter.x += fighter.vx * DT;
    if (fighter.y >= GROUND_Y) {
      fighter.y = GROUND_Y;
      fighter.vy = 0;
      // Only a jump resolves to IDLE on landing; a fighter knocked into the air
      // stays in HITSTUN until its timer runs out.
      if (fighter.state === FighterState.JUMP) fighter.state = FighterState.IDLE;
    }
  } else if (!isSelfPropelledAttack(fighter)) {
    fighter.x += fighter.vx * DT;
  }

  if (
    fighter.state === FighterState.HITSTUN ||
    fighter.state === FighterState.BLOCKSTUN ||
    fighter.state === FighterState.KO
  ) {
    fighter.vx *= STUN_FRICTION_PER_TICK;
  }

  fighter.x = clamp(fighter.x, ARENA_MIN_X, ARENA_MAX_X);
}

/**
 * Dash and slide attacks drive themselves forward during their active frames, so
 * applying `vx` on top would move them at double speed.
 */
function isSelfPropelledAttack(fighter: SimFighter): boolean {
  const kind = fighter.attack?.kind;
  return kind === 'dash' || kind === 'slide' || kind === 'dashStrike';
}

export function config(fighter: SimFighter): FighterConfig {
  return getFighterConfig(fighter.configId);
}

/** True during the frames an attack can connect. */
export function attackActive(fighter: SimFighter): boolean {
  const attack = fighter.attack;
  if (!attack) return false;
  const spec = getSpec(attack.specId);
  return (
    attack.elapsedTicks >= spec.startupTicks &&
    attack.elapsedTicks < spec.startupTicks + spec.activeTicks
  );
}

/** Total lifetime of an attack, with recovery scaled by the control stat. */
function totalAttackTicks(spec: TickSpec, controlStat: number): number {
  return (
    spec.startupTicks +
    spec.activeTicks +
    spec.recoveryTicks * CONTROL_RECOVERY_MULTIPLIER(controlStat)
  );
}

export function canUseSpecial(fighter: SimFighter, tick: number): boolean {
  return (
    tick >= fighter.nextSpecialTick &&
    !isKO(fighter) &&
    !isAttacking(fighter) &&
    fighter.state !== FighterState.HITSTUN &&
    fighter.state !== FighterState.BLOCKSTUN
  );
}

/**
 * One tick of a fighter's state machine, ported from `Fighter.update`.
 *
 * The branch order below is load-bearing and matches the original: an attack in
 * progress beats stun, which beats round-end states, which beat input. Facing is
 * refreshed *before* the guard is evaluated, so turning around and blocking
 * resolve on the same tick.
 *
 * See docs/sim-spec.md §3.
 */
export function stepFighter(
  fighter: SimFighter,
  opponent: SimFighter,
  input: InputFrame,
  tick: number,
  inputEnabled: boolean,
  player: PlayerIndex,
  events: SimEvent[],
): void {
  const cfg = config(fighter);

  if (!isKO(fighter)) fighter.facing = opponent.x >= fighter.x ? 1 : -1;

  const away = opponent.x > fighter.x ? -1 : 1;
  const move = inputEnabled ? moveAxis(input) : 0;
  const crouch = inputEnabled && isDown(input, BUTTON.Down);
  /**
   * A charge cannot be guarded out of — that is the risk that pays for its
   * damage, and it is why any hit that arrives mid-charge simply lands.
   *
   * Holding down no longer cancels the guard. It used to, which meant crouching
   * was purely a way to make yourself shorter and there was no low guard at all
   * — so a `low` attack would have been unblockable by anyone rather than
   * blockable by anyone crouching, which is the opposite of what it should mean.
   */
  fighter.guardHeld =
    inputEnabled &&
    move === away &&
    fighter.state !== FighterState.H_CHARGING &&
    !isDashing(fighter);
  fighter.guardCrouching = fighter.guardHeld && crouch;

  // The crouch buffer lets a down press count toward the ultimate motion for a
  // few ticks after release. Tracked here rather than in the controller so that a
  // resimulation of the same bytes reproduces it.
  if (inputEnabled && justPressed(input, fighter.prevButtons, BUTTON.Down)) {
    fighter.downBufferedUntilTick = tick + INPUT_BUFFER_TICKS;
  }

  /**
   * Record before the state machine runs, so a motion completed on this tick is
   * visible to the intent that reads it on this tick.
   *
   * While input is disabled a neutral word is recorded rather than the real one,
   * for the same reason `prevButtons` is cleared below: the round intro must not
   * let a player pre-load a motion that fires the instant control is handed over.
   */
  recordInput(fighter.commandHistory, inputEnabled ? input : EMPTY_INPUT);

  // Timed statuses tick down here, once, before anything reads them. Counting down
  // rather than comparing against an absolute expiry means a snapshot restored into
  // a world at a different tick still has the right amount left on it.
  if (fighter.installTicks > 0) fighter.installTicks -= 1;
  if (fighter.slowTicks > 0) fighter.slowTicks -= 1;

  if (fighter.attack) {
    // A cancel is offered *before* the attack advances, so the frame the move
    // connected on is itself cancellable. Waiting a tick would make the window
    // one frame shorter than the frame data says it is.
    if (!(inputEnabled && tryCancel(fighter, input, tick, cfg, player, events))) {
      advanceAttack(fighter, cfg);
    }
  } else if (isDashing(fighter)) {
    advanceDash(fighter, cfg);
  } else if (
    fighter.state === FighterState.HITSTUN ||
    fighter.state === FighterState.BLOCKSTUN
  ) {
    fighter.stateRemainingTicks -= 1;
    if (fighter.stateRemainingTicks <= 0) {
      fighter.state = isAirborne(fighter) ? FighterState.JUMP : FighterState.IDLE;
    }
  } else if (fighter.state === FighterState.KO || fighter.state === FighterState.VICTORY) {
    // Round-end states intentionally ignore input.
  } else if (inputEnabled) {
    processIntent(fighter, opponent, input, tick, cfg, player, events);
  } else {
    fighter.vx = 0;
    if (!isAirborne(fighter) && fighter.state !== FighterState.CROUCH) {
      fighter.state = FighterState.IDLE;
    }
  }

  stepPhysics(fighter);

  /**
   * While input is disabled the previous mask is cleared rather than recorded, so
   * a button held through the round intro registers as a fresh press on the first
   * tick of the fight.
   *
   * That reproduces the original: BattleScene only called `controller.update()`
   * during the `fight` phase, so Phaser's `JustDown` flag was set by the keydown
   * during the intro and nobody consumed it — the attack came out the instant
   * control was handed over. Recording the mask here instead would quietly remove
   * that buffer.
   */
  fighter.prevButtons = inputEnabled ? input : 0;
}

function advanceAttack(fighter: SimFighter, cfg: FighterConfig): void {
  const attack = fighter.attack;
  if (!attack) return;
  const spec = getSpec(attack.specId);

  const previous = attack.elapsedTicks;
  attack.elapsedTicks += 1;
  attack.activeJustStarted =
    previous < spec.startupTicks && attack.elapsedTicks >= spec.startupTicks;

  applyAttackMotion(fighter, spec);

  if (
    attack.elapsedTicks >= totalAttackTicks(spec, cfg.controlStat) &&
    fighter.state !== FighterState.KO
  ) {
    // Paid on completion, not on contact: a taunt or a flex earns its meter for
    // having been held all the way through, and cannot whiff. Clamped here
    // rather than through combat.ts's `addEnergy`, which would make this module
    // and that one import each other.
    if (spec.meterOnComplete > 0) {
      fighter.energy = Math.min(MAX_ENERGY, fighter.energy + spec.meterOnComplete);
    }
    // An install is earned by seeing the move through, not by landing it.
    if (spec.selfStatus?.kind === 'install') fighter.installTicks = spec.selfStatus.ticks;
    fighter.attack = null;
    fighter.state = isAirborne(fighter) ? FighterState.JUMP : FighterState.IDLE;
  }
}

/** Dash, slide and heavy drag the fighter forward during their active frames. */
function applyAttackMotion(fighter: SimFighter, spec: TickSpec): void {
  if (!attackActive(fighter)) return;
  if (spec.kind === 'dash' || spec.kind === 'dashStrike') {
    fighter.x += fighter.facing * DASH_ATTACK_SPEED * DT;
  } else if (spec.kind === 'slide') {
    fighter.x += fighter.facing * SLIDE_ATTACK_SPEED * DT;
  } else if (spec.id === HEAVY_SPEC.id) {
    fighter.x += fighter.facing * HEAVY_ATTACK_DRIFT * DT;
  }
}

// --- Dashes -----------------------------------------------------------------

export function isDashing(fighter: SimFighter): boolean {
  return (
    fighter.state === FighterState.DASH_FORWARD || fighter.state === FighterState.DASH_BACK
  );
}

/**
 * One tick of a dash, which is committed movement: no attacks, no guard, no
 * turning around. That commitment is the whole risk — a back dash read is a free
 * punish, and it is what stops dashing from being a strictly better walk.
 */
function advanceDash(fighter: SimFighter, cfg: FighterConfig): void {
  const forward = fighter.state === FighterState.DASH_FORWARD;
  const speed = (forward ? DASH_SPEED : BACK_DASH_SPEED) * DASH_SPEED_BY_STAT(cfg.speedStat);
  fighter.vx = fighter.facing * (forward ? 1 : -1) * speed;
  fighter.dashTicks -= 1;
  if (fighter.dashTicks <= 0) {
    fighter.vx = 0;
    fighter.state = FighterState.IDLE;
  }
}

function startDash(fighter: SimFighter, forward: boolean): void {
  fighter.state = forward ? FighterState.DASH_FORWARD : FighterState.DASH_BACK;
  fighter.dashTicks = DASH_TICKS;
}

// --- Chords -----------------------------------------------------------------

/**
 * The three meme moves, on button pairs.
 *
 * Returns true when the chord was *recognised*, whether or not a move came out.
 * That distinction matters: an unaffordable Impact still has to swallow the input,
 * because falling through would give the player a heavy they did not ask for at
 * the exact moment they learn they are out of meter.
 *
 * Order is not a preference, it is a requirement. Heavy+Special is also a
 * Special, and Light+Special is also a Light; read the single buttons first and
 * the pairs become unreachable.
 */
function tryChord(
  fighter: SimFighter,
  tick: number,
  player: PlayerIndex,
  events: SimEvent[],
): boolean {
  const history = fighter.commandHistory;

  if (matchesChord(history, BUTTON.Heavy, BUTTON.Special)) {
    if (fighter.energy >= IMPACT_SPEC.meterCost) {
      startAttack(fighter, IMPACT_SPEC, FighterState.MEME_IMPACT, false, false, player, events);
    }
    return true;
  }
  if (matchesChord(history, BUTTON.Light, BUTTON.Special)) {
    // The cooldown is the parry's whole cost — there is no meter price, so without
    // it the correct answer to any pressure would be to hold both buttons.
    if (tick >= fighter.nextParryTick) {
      fighter.nextParryTick = tick + PARRY_SPEC.cooldownTicks;
      startAttack(fighter, PARRY_SPEC, FighterState.MEME_PARRY, false, false, player, events);
    }
    return true;
  }
  /**
   * Rush from neutral is a paid forward hop rather than nothing.
   *
   * The upgraded build gave it away free here and charged 20 only for the cancel.
   * One price for one move is the simpler rule and the one worth keeping: a free
   * version would be a second dash that happens to be spelled differently, and the
   * reason to reach for this one is that it is the button pair that continues a
   * combo — so the neutral version earns its place only by teaching the cancel.
   */
  if (matchesChord(history, BUTTON.Light, BUTTON.Heavy)) {
    if (fighter.energy >= RUSH_SPEC.meterCost) {
      startAttack(fighter, RUSH_SPEC, FighterState.MEME_RUSH, false, false, player, events);
    }
    return true;
  }
  return false;
}

/**
 * How long after committing to a move its chord may still be claimed.
 *
 * Without this a chord is a one-tick input and nothing else, which is not a
 * timing window any hand can hit. The first button of the pair lands alone, comes
 * out as its own move immediately, and by the time the second arrives the fighter
 * is busy — so Heavy-then-Special is a heavy, every time, and the Impact is
 * effectively unreachable.
 *
 * The grace period lets the chord take back a move that has not yet done anything.
 * Bounded by `CHORD_LENIENCY` and by startup — nothing has left the fighter in
 * three ticks — so this cannot rescue a swing that was already thrown, only one
 * that was misread on the way out.
 */
function withinChordGrace(elapsedTicks: number): boolean {
  return elapsedTicks < CHORD_LENIENCY;
}

// --- Cancels ----------------------------------------------------------------

/** Whether a cancel rule's condition is satisfied by what the move did. */
function cancelAllowed(rule: CancelRule, result: MoveResult): boolean {
  if (result === 'none') return false;
  if (rule.on === 'hitOrBlock') return true;
  return rule.on === result;
}

/**
 * Try to cut the current move short and start another.
 *
 * This is the combo system. Without it every move plays out its recovery in full,
 * the opponent always gets their turn back, and no two moves can ever be linked —
 * which is why a game can have twelve fighters' worth of specials and still feel
 * like it has none.
 *
 * Returns true if a new move was started, in which case the caller must *not*
 * advance the old one: it no longer exists.
 */
function tryCancel(
  fighter: SimFighter,
  input: InputFrame,
  tick: number,
  cfg: FighterConfig,
  player: PlayerIndex,
  events: SimEvent[],
): boolean {
  const attack = fighter.attack;
  if (!attack) return false;
  const spec = getSpec(attack.specId);

  /**
   * A chord may take back the move that its own first button just started, for
   * the few ticks before that move has done anything. This is the only reason a
   * chord is reachable at all — see `withinChordGrace`.
   *
   * Restricted to moves that can be cancelled, which is exactly the four grounded
   * normals: an Impact cannot be second-guessed into a parry, and a special cannot
   * be taken back at all.
   */
  if (spec.cancels.length > 0 && withinChordGrace(attack.elapsedTicks)) {
    const previous = fighter.attack;
    const previousState = fighter.state;
    fighter.attack = null;
    tryChord(fighter, tick, player, events);
    // Only a chord that actually produced a move takes the old one's place. A
    // recognised-but-unaffordable chord returns true from `tryChord` so that it
    // swallows the input in neutral — honouring that here would delete the move
    // in progress and leave the fighter in an attack state with nothing running.
    if (fighter.attack) return true;
    fighter.attack = previous;
    fighter.state = previousState;
  }

  if (spec.cancels.length === 0) return false;

  const history = fighter.commandHistory;

  // Rush first, matching the upgraded build's precedence. Light+Heavy is also a
  // light *and* a heavy, so anything that reads those buttons separately would
  // otherwise eat the chord before it is recognised.
  const rushRule = spec.cancels.find((rule) => rule.into === 'rush');
  if (
    rushRule &&
    cancelAllowed(rushRule, attack.result) &&
    fighter.energy >= RUSH_SPEC.meterCost &&
    matchesChord(history, BUTTON.Light, BUTTON.Heavy)
  ) {
    fighter.attack = null;
    startAttack(fighter, RUSH_SPEC, FighterState.MEME_RUSH, false, false, player, events);
    return true;
  }

  const specialRule = spec.cancels.find((rule) => rule.into === 'special');
  if (
    specialRule &&
    cancelAllowed(specialRule, attack.result) &&
    justPressed(input, fighter.prevButtons, BUTTON.Special)
  ) {
    const motioned = requestedSpecial(fighter, cfg);
    // A cancel needs a *named* special. The bare button starts a charge, and a
    // charge cannot be held out of another move's recovery — it would freeze the
    // fighter mid-swing with no way to read the input that got them there.
    if (motioned && tick >= fighter.nextSpecialTick) {
      fighter.attack = null;
      startMotionSpecial(fighter, tick, false, cfg, motioned.id, player, events);
      return true;
    }
  }

  return false;
}

function processIntent(
  fighter: SimFighter,
  opponent: SimFighter,
  input: InputFrame,
  tick: number,
  cfg: FighterConfig,
  player: PlayerIndex,
  events: SimEvent[],
): void {
  const move = moveAxis(input);
  const crouch = isDown(input, BUTTON.Down);
  const lightPressed = justPressed(input, fighter.prevButtons, BUTTON.Light);
  const heavyPressed = justPressed(input, fighter.prevButtons, BUTTON.Heavy);
  const jumpPressed = justPressed(input, fighter.prevButtons, BUTTON.Up);
  const throwPressed = justPressed(input, fighter.prevButtons, BUTTON.Throw);
  const specialEdge = justPressed(input, fighter.prevButtons, BUTTON.Special);
  const downBuffered = crouch || tick <= fighter.downBufferedUntilTick;
  /** Which special the motion history is asking for, if any. Asked once. */
  const motioned = requestedSpecial(fighter, cfg);

  /**
   * Two ways to ask for an ultimate.
   *
   * The dedicated button is the upgraded build's scheme and the one the controls
   * screen teaches. Down-plus-special is the trunk's original motion, kept because
   * it is what existing hands already know.
   *
   * **A recognised motion beats the legacy one.** Every quarter-circle passes
   * through a down two or three ticks before the button, comfortably inside the
   * eight-tick crouch buffer — so without this, 236 with a full meter fired the
   * ultimate and the fighter's own fireball became unreachable at exactly the
   * moment it mattered. It went unnoticed at first because the motion tests ran on
   * an empty meter, where the ultimate falls through to the motion anyway.
   */
  const legacyUltimateMotion = specialEdge && downBuffered && !motioned;
  const ultimatePressed =
    justPressed(input, fighter.prevButtons, BUTTON.Ultimate) || legacyUltimateMotion;
  /** A special edge does its ordinary job unless the legacy motion claimed it. */
  const specialPressed = specialEdge && !legacyUltimateMotion;

  const baseSpeed = SPEED_BY_STAT[cfg.speedStat] ?? SPEED_BY_STAT[3]!;
  const speed = fighter.slowTicks > 0 ? baseSpeed * SLOW_MOVE_MULTIPLIER : baseSpeed;

  /**
   * Winding up beats everything.
   *
   * A charge is a commitment: no walking, no jumping, no normals, no guard. That
   * is what makes holding for level 3 a decision the opponent can punish rather
   * than a free option, and it is why this returns before the rest of the intent
   * is even looked at.
   *
   * Being hit cancels it, and needs no code here — a connected hit puts the
   * fighter in HITSTUN, and `H_CHARGING` is the only thing that keeps a charge
   * alive. Nor can the charge be blocked out of, since guard is off while
   * charging: whatever lands, lands.
   */
  if (fighter.state === FighterState.H_CHARGING) {
    fighter.vx = 0;
    /**
     * The same grace period the normals get, for the same reason: Heavy+Special
     * with the special landing first starts a charge, and without this the Impact
     * would be unreachable from that order of pressing.
     */
    if (withinChordGrace(fighter.chargeTicks)) {
      tryChord(fighter, tick, player, events);
      // Same rule as the cancel grace: only a chord that produced a move takes
      // over. An unaffordable one must leave the charge exactly as it was rather
      // than resetting it on every tick of the grace window.
      if (fighter.attack) {
        fighter.chargeTicks = 0;
        return;
      }
    }
    if (isDown(input, BUTTON.Special)) {
      // Capped rather than free-running: an unbounded counter would keep changing
      // the hash forever on a fighter who never lets go.
      fighter.chargeTicks = Math.min(fighter.chargeTicks + 1, CHARGE_LEVEL_3_TICKS);
      return;
    }
    releaseCharge(fighter, cfg, player, events);
    return;
  }

  if (isAirborne(fighter)) {
    if (lightPressed) startAttack(fighter, NORMALS.air.light, FighterState.LIGHT_ATTACK, false, true, player, events);
    else if (heavyPressed) startAttack(fighter, NORMALS.air.heavy, FighterState.HEAVY_ATTACK, false, true, player, events);
    if (!fighter.attack) {
      fighter.vx = move * speed * AIR_CONTROL_SCALE;
      fighter.state = FighterState.JUMP;
    }
    return;
  }

  const away = opponent.x > fighter.x ? -1 : 1;
  if (move === away && Math.abs(opponent.x - fighter.x) < BLOCK_STANCE_RANGE) {
    // Crouch-blocking is still BLOCK, not CROUCH: `guardCrouching` carries the
    // height, so the guard reads the same to the hit resolver either way.
    fighter.state = FighterState.BLOCK;
    fighter.vx = 0;
    return;
  }

  // Chords outrank every single-button move; see `tryChord`.
  if (tryChord(fighter, tick, player, events)) return;

  if (ultimatePressed) {
    if (fighter.energy >= MAX_ENERGY && canUseSpecial(fighter, tick)) {
      fighter.energy = 0;
      startAttack(fighter, getSpec(cfg.ultimate.id), FighterState.ULTIMATE, crouch, false, player, events);
      return;
    }
    // An ultimate motion without meter is not a whiff — it comes out as the
    // fighter's defining special instead. Ported behaviour.
    if (canUseSpecial(fighter, tick)) {
      const fallback = motioned ?? cfg.specials.quarterForward;
      startMotionSpecial(fighter, tick, crouch, cfg, fallback.id, player, events);
    }
    return;
  }
  if (specialPressed) {
    if (motioned) {
      if (canUseSpecial(fighter, tick)) {
        startMotionSpecial(fighter, tick, crouch, cfg, motioned.id, player, events);
      }
      return;
    }
    /**
     * No motion, so this is the chargeable special — and it has no cooldown, so
     * it is deliberately not gated on `nextSpecialTick`. A fighter who has just
     * spent a motion special can still wind this one up; the recovery on each
     * release is the only limiter, which is what the upgraded build specified.
     */
    fighter.state = FighterState.H_CHARGING;
    fighter.chargeTicks = 0;
    fighter.vx = 0;
    return;
  }
  /**
   * Before the normals, because a throw is what you reach for when they will not
   * stop blocking, and having to beat your own light to it would defeat the point.
   *
   * No cooldown gate: by the time `processIntent` runs the fighter is provably
   * free to act, and the throw's twenty frames of recovery are its cost — the same
   * deal the normals get. Sharing `nextSpecialTick` would have meant a spent
   * special locked out the throw and vice versa.
   */
  if (throwPressed) {
    startAttack(fighter, THROW_SPEC, FighterState.THROW, false, false, player, events);
    return;
  }
  // Crouching no longer just shrinks the box the same normal comes out of: it
  // selects a different move, which is what makes ducking an offensive choice
  // rather than only a defensive one.
  const stance = crouch ? 'crouch' : 'stand';
  if (lightPressed) {
    startAttack(fighter, NORMALS[stance].light, FighterState.LIGHT_ATTACK, crouch, false, player, events);
    return;
  }
  if (heavyPressed) {
    startAttack(fighter, NORMALS[stance].heavy, FighterState.HEAVY_ATTACK, crouch, false, player, events);
    return;
  }
  if (jumpPressed) {
    fighter.vy = JUMP_VELOCITY;
    fighter.state = FighterState.JUMP;
    events.push({ t: 'jump', player });
    return;
  }
  if (crouch) {
    fighter.vx = 0;
    fighter.state = FighterState.CROUCH;
    return;
  }
  /**
   * Dashes come after every button, because a double tap is a *movement* input
   * and losing an attack to one would be far worse than the reverse. Walking
   * forward and pressing light must never come out as a dash.
   */
  if (matchesDoubleTap(fighter.commandHistory, 6, fighter.facing)) {
    startDash(fighter, true);
    return;
  }
  if (matchesDoubleTap(fighter.commandHistory, 4, fighter.facing)) {
    startDash(fighter, false);
    return;
  }
  if (move !== 0) {
    fighter.vx = move * speed;
    fighter.state = FighterState.WALK;
    return;
  }
  fighter.vx = 0;
  fighter.state = FighterState.IDLE;
}

/**
 * Which special the player just asked for, or null for none.
 *
 * Checked most-specific first. A dragon punch contains a forward and a down, so a
 * 623 read after a 236 would never fire — the more demanding motion has to win.
 * The double tap is tested last because it is the least deliberate input and
 * should not pre-empt a motion the player actually rolled.
 */
function requestedSpecial(fighter: SimFighter, cfg: FighterConfig): AttackSpec | null {
  const history = fighter.commandHistory;
  const facing = fighter.facing;
  const { quarterForward, quarterBack, dragonPunch, functionMove } = cfg.specials;

  if (dragonPunch && matchesMotion(history, DRAGON_PUNCH, facing)) return dragonPunch;
  if (matchesMotion(history, QUARTER_CIRCLE_BACK, facing)) return quarterBack;
  if (matchesMotion(history, QUARTER_CIRCLE_FORWARD, facing)) return quarterForward;
  if (matchesDoubleTap(history, 2, facing)) return functionMove;
  return null;
}

function startMotionSpecial(
  fighter: SimFighter,
  tick: number,
  crouching: boolean,
  cfg: FighterConfig,
  specId: string,
  player: PlayerIndex,
  events: SimEvent[],
): void {
  const spec = getSpec(specId);
  // Special cooldowns use 1.08 - stat * 0.025, distinct from the 1.05 used for
  // attack recovery. The split is in the original and is preserved deliberately.
  fighter.nextSpecialTick = tick + spec.cooldownTicks * CONTROL_COOLDOWN_MULTIPLIER(cfg.controlStat);
  startAttack(fighter, spec, FighterState.SPECIAL, crouching, false, player, events);
}

/**
 * Fire the charge at whatever level the hold reached.
 *
 * The level is recomputed from `chargeTicks` rather than tracked alongside it, so
 * there is one number to snapshot and no way for the two to disagree.
 */
function releaseCharge(
  fighter: SimFighter,
  cfg: FighterConfig,
  player: PlayerIndex,
  events: SimEvent[],
): void {
  const level = chargeLevel(fighter.chargeTicks);
  const spec = getSpec(chargeSpecialFor(cfg.id).levels[level - 1]!.id);
  fighter.chargeTicks = 0;
  startAttack(fighter, spec, FighterState.SPECIAL, false, false, player, events);
}

function startAttack(
  fighter: SimFighter,
  spec: TickSpec,
  state: FighterState,
  crouching: boolean,
  airborne: boolean,
  player: PlayerIndex,
  events: SimEvent[],
): void {
  fighter.state = state;
  if (!airborne) fighter.vx = 0;
  fighter.attack = {
    specId: spec.id,
    kind: spec.kind,
    elapsedTicks: 0,
    activeJustStarted: false,
    crouching,
    airborne,
    hitMask: 0,
    presented: false,
    hitsUsed: 0,
    rehitReadyTick: 0,
    armorUsed: 0,
    result: 'none',
  };
  // Paid on startup, not on contact: that is what makes a whiffed Impact hurt.
  if (spec.meterCost > 0) fighter.energy = Math.max(0, fighter.energy - spec.meterCost);
  events.push({ t: 'attackStart', player, specId: spec.id, state });
}
