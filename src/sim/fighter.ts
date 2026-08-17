import { getFighterConfig } from '../fighters/fighterData';
import type { FighterConfig } from '../fighters/FighterConfig';
import { FighterState } from '../fighters/FighterState';
import { getSpec, HEAVY_SPEC, LIGHT_SPEC, THROW_SPEC, type TickSpec } from './attackSpecs';
import {
  AIR_CONTROL_SCALE,
  ARENA_MAX_X,
  ARENA_MIN_X,
  BLOCK_STANCE_RANGE,
  CONTROL_COOLDOWN_MULTIPLIER,
  CONTROL_RECOVERY_MULTIPLIER,
  DASH_ATTACK_SPEED,
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
import type { AttackSpec } from '../combat/AttackSpec';
import { CHARGE_LEVEL_3_TICKS, chargeLevel, chargeSpecialFor } from '../fighters/chargeSpecials';
import {
  DRAGON_PUNCH,
  QUARTER_CIRCLE_BACK,
  QUARTER_CIRCLE_FORWARD,
  createCommandHistory,
  matchesDoubleTap,
  matchesMotion,
  recordInput,
  resetCommandHistory,
} from './command';
import { BUTTON, EMPTY_INPUT, isDown, justPressed, moveAxis, type InputFrame } from './input';
import type { PlayerIndex, SimEvent, SimFighter } from './types';

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
  fighter.prevButtons = 0;
  resetCommandHistory(fighter.commandHistory);
  fighter.downBufferedUntilTick = -1;
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

export function isAttacking(fighter: SimFighter): boolean {
  return (
    fighter.state === FighterState.LIGHT_ATTACK ||
    fighter.state === FighterState.HEAVY_ATTACK ||
    fighter.state === FighterState.SPECIAL ||
    fighter.state === FighterState.ULTIMATE ||
    fighter.state === FighterState.THROW
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
  // A charge cannot be guarded out of — that is the risk that pays for its
  // damage, and it is why any hit that arrives mid-charge simply lands.
  fighter.guardHeld =
    inputEnabled && move === away && !crouch && fighter.state !== FighterState.H_CHARGING;

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
    advanceAttack(fighter, cfg);
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
    if (lightPressed) startAttack(fighter, LIGHT_SPEC, FighterState.LIGHT_ATTACK, false, true, player, events);
    else if (heavyPressed) startAttack(fighter, HEAVY_SPEC, FighterState.HEAVY_ATTACK, false, true, player, events);
    if (!fighter.attack) {
      fighter.vx = move * speed * AIR_CONTROL_SCALE;
      fighter.state = FighterState.JUMP;
    }
    return;
  }

  const away = opponent.x > fighter.x ? -1 : 1;
  if (move === away && !crouch && Math.abs(opponent.x - fighter.x) < BLOCK_STANCE_RANGE) {
    fighter.state = FighterState.BLOCK;
    fighter.vx = 0;
    return;
  }

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
  if (lightPressed) {
    startAttack(fighter, LIGHT_SPEC, FighterState.LIGHT_ATTACK, crouch, false, player, events);
    return;
  }
  if (heavyPressed) {
    startAttack(fighter, HEAVY_SPEC, FighterState.HEAVY_ATTACK, crouch, false, player, events);
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
  };
  events.push({ t: 'attackStart', player, specId: spec.id, state });
}
