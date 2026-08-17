import { getFighterConfig } from '../fighters/fighterData';
import type { FighterConfig } from '../fighters/FighterConfig';
import { FighterState } from '../fighters/FighterState';
import { getSpec, HEAVY_SPEC, LIGHT_SPEC, type TickSpec } from './attackSpecs';
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
  SPEED_BY_STAT,
  STUN_FRICTION_PER_TICK,
} from './constants';
import { createCommandHistory, recordInput, resetCommandHistory } from './command';
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
    downBufferedUntilTick: 0,
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
  fighter.downBufferedUntilTick = 0;
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
    fighter.state === FighterState.ULTIMATE
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
  return kind === 'dash' || kind === 'slide';
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
  fighter.guardHeld = inputEnabled && move === away && !crouch;

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
    fighter.attack = null;
    fighter.state = isAirborne(fighter) ? FighterState.JUMP : FighterState.IDLE;
  }
}

/** Dash, slide and heavy drag the fighter forward during their active frames. */
function applyAttackMotion(fighter: SimFighter, spec: TickSpec): void {
  if (!attackActive(fighter)) return;
  if (spec.kind === 'dash') {
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
  const specialEdge = justPressed(input, fighter.prevButtons, BUTTON.Special);
  const downBuffered = crouch || tick <= fighter.downBufferedUntilTick;
  const specialPressed = specialEdge && !downBuffered;
  const ultimatePressed = specialEdge && downBuffered;

  const speed = SPEED_BY_STAT[cfg.speedStat] ?? SPEED_BY_STAT[3]!;

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
    // special instead. Ported behaviour.
    if (canUseSpecial(fighter, tick)) startSpecial(fighter, tick, crouch, cfg, player, events);
    return;
  }
  if (specialPressed && canUseSpecial(fighter, tick)) {
    startSpecial(fighter, tick, crouch, cfg, player, events);
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

function startSpecial(
  fighter: SimFighter,
  tick: number,
  crouching: boolean,
  cfg: FighterConfig,
  player: PlayerIndex,
  events: SimEvent[],
): void {
  const spec = getSpec(cfg.special.id);
  // Special cooldowns use 1.08 - stat * 0.025, distinct from the 1.05 used for
  // attack recovery. The split is in the original and is preserved deliberately.
  fighter.nextSpecialTick = tick + spec.cooldownTicks * CONTROL_COOLDOWN_MULTIPLIER(cfg.controlStat);
  startAttack(fighter, spec, FighterState.SPECIAL, crouching, false, player, events);
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
