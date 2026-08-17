import { FighterState } from '../fighters/FighterState';
import { ultimateDefinitionFor } from '../fighters/ultimateDefinitions';
import { ultimateTimelineFor, type UltimatePhase } from '../fighters/ultimateTimelines';
import { getSpec, type TickSpec } from './attackSpecs';
import {
  ARENA_MAX_X,
  ARENA_MIN_X,
  ENDING_TICKS,
  GAME_WIDTH,
  GROUND_Y,
  INTRO_TICKS,
  P1_SPAWN_X,
  P2_SPAWN_X,
  PUSH_APART_DISTANCE,
  ROUND_CALL_TICKS,
  ROUND_TICKS,
  ROUNDS_TO_WIN,
  DT,
} from './constants';
import {
  canBlockImpact,
  getHurtbox,
  getMeleeHitbox,
  impactWeight,
  rectsIntersect,
  resolveHit,
  ultimatePhaseHitStop,
} from './combat';
import { createFighter, isAirborne, isKO, resetFighter, stepFighter, attackActive } from './fighter';
import { finalizeHash, hashBool, hashFloat, hashInt, hashString, HASH_SEED } from './hash';
import { EMPTY_INPUT, type InputFrame } from './input';
import { createRng, nextInt } from './rng';
import {
  HIT_P1,
  HIT_P2,
  type PlayerIndex,
  type Rect,
  type RoundWinner,
  type SimEvent,
  type SimFighter,
  type SimProjectile,
  type SimUltimate,
  type SimWorld,
  type SimZone,
} from './types';

/**
 * The whole match, as one steppable state machine.
 *
 * Ported from BattleScene.update / beginRound / endRound plus CombatSystem's
 * entity lists. The round phase timers that were `scene.time.delayedCall` are now
 * tick counters in the world, because a wall-clock timer drifts between two
 * clients and cannot be replayed.
 *
 * See docs/sim-spec.md §8-9.
 */

export interface MatchSetup {
  seed: number;
  p1Character: string;
  p2Character: string;
  stage: string;
}

export function createWorld(setup: MatchSetup): SimWorld {
  return {
    tick: 0,
    phase: 'intro',
    phaseTicks: 0,
    roundNumber: 1,
    roundTicksRemaining: ROUND_TICKS,
    hitStopTicks: 0,
    fighters: [
      createFighter(setup.p1Character, P1_SPAWN_X, 1),
      createFighter(setup.p2Character, P2_SPAWN_X, -1),
    ],
    projectiles: [],
    zones: [],
    ultimates: [],
    nextEntityId: 1,
    roundWins: [0, 0],
    matchWinner: null,
    stage: setup.stage,
    rng: createRng(setup.seed),
  };
}

/**
 * Advance the world exactly one tick and return what happened.
 *
 * `inputs` is the raw button state for both players; during the intro and the
 * round-end wind-down it is ignored, matching the original scene, which simply
 * did not poll its controllers outside the fight phase.
 */
export function stepWorld(world: SimWorld, inputs: [InputFrame, InputFrame]): SimEvent[] {
  const events: SimEvent[] = [];

  // Hit-stop freezes everything, including the round clock. It used to live on
  // the scene, which meant it could never be part of a rollback snapshot.
  if (world.hitStopTicks > 0) {
    world.hitStopTicks -= 1;
    world.tick += 1;
    return events;
  }

  if (world.phase === 'fight') {
    stepFighter(world.fighters[0], world.fighters[1], inputs[0], world.tick, true, 0, events);
    stepFighter(world.fighters[1], world.fighters[0], inputs[1], world.tick, true, 1, events);
    resolvePushCollision(world);
    stepCombat(world, events);
    world.roundTicksRemaining = Math.max(0, world.roundTicksRemaining - 1);
    checkRoundEnd(world, events);
  } else {
    stepFighter(world.fighters[0], world.fighters[1], EMPTY_INPUT, world.tick, false, 0, events);
    stepFighter(world.fighters[1], world.fighters[0], EMPTY_INPUT, world.tick, false, 1, events);
    resolvePushCollision(world);
    advanceNonFightPhase(world, events);
  }

  world.phaseTicks += 1;
  world.tick += 1;
  return events;
}

// --- Phases -----------------------------------------------------------------

function advanceNonFightPhase(world: SimWorld, events: SimEvent[]): void {
  if (world.phase === 'intro') {
    if (world.phaseTicks === 0) events.push({ t: 'roundStart', round: world.roundNumber });
    if (world.phaseTicks === ROUND_CALL_TICKS) events.push({ t: 'announce', text: 'CAT FIGHT!' });
    if (world.phaseTicks + 1 >= INTRO_TICKS) enterPhase(world, 'fight');
    return;
  }

  // 'ending'
  if (world.phaseTicks + 1 >= ENDING_TICKS) {
    if (world.matchWinner !== null) return; // Match is over; the scene takes it from here.
    world.roundNumber += 1;
    beginRound(world);
  }
}

function enterPhase(world: SimWorld, phase: SimWorld['phase']): void {
  world.phase = phase;
  // -1 because the caller increments phaseTicks after this returns, so the first
  // tick of the new phase sees phaseTicks === 0.
  world.phaseTicks = -1;
}

function beginRound(world: SimWorld): void {
  world.roundTicksRemaining = ROUND_TICKS;
  world.hitStopTicks = 0;
  world.projectiles = [];
  world.zones = [];
  world.ultimates = [];
  resetFighter(world.fighters[0], P1_SPAWN_X, 1);
  resetFighter(world.fighters[1], P2_SPAWN_X, -1);
  enterPhase(world, 'intro');
}

function checkRoundEnd(world: SimWorld, events: SimEvent[]): void {
  const [p1, p2] = world.fighters;

  if (p1.hp <= 0 || p2.hp <= 0) {
    const winner: RoundWinner = p1.hp <= 0 && p2.hp <= 0 ? 0 : p1.hp <= 0 ? 2 : 1;
    endRound(world, winner, 'KO', events);
    return;
  }

  if (world.roundTicksRemaining <= 0) {
    const diff = p1.hp - p2.hp;
    // Health is fractional, so an exact tie is vanishingly unlikely; the original
    // treats anything inside a hundredth of a point as a draw.
    const winner: RoundWinner = Math.abs(diff) < 0.01 ? 0 : diff > 0 ? 1 : 2;
    endRound(world, winner, 'TIME', events);
  }
}

function endRound(
  world: SimWorld,
  winner: RoundWinner,
  reason: 'KO' | 'TIME',
  events: SimEvent[],
): void {
  if (winner === 1) world.roundWins[0] += 1;
  else if (winner === 2) world.roundWins[1] += 1;

  if (winner !== 0) {
    const winnerFighter = world.fighters[winner - 1]!;
    const loserFighter = world.fighters[winner === 1 ? 1 : 0]!;
    forceVictory(winnerFighter);
    // On a time-out nobody actually fell over, so the loser is posed as KO'd.
    if (reason === 'TIME') forceKO(loserFighter);
  }

  events.push({ t: 'roundEnd', winner, reason });

  if (world.roundWins[0] >= ROUNDS_TO_WIN || world.roundWins[1] >= ROUNDS_TO_WIN) {
    world.matchWinner = world.roundWins[0] >= ROUNDS_TO_WIN ? 0 : 1;
    events.push({ t: 'matchEnd', winner: world.matchWinner });
  }

  enterPhase(world, 'ending');
}

function forceVictory(fighter: SimFighter): void {
  fighter.state = FighterState.VICTORY;
  fighter.attack = null;
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.y = GROUND_Y;
}

function forceKO(fighter: SimFighter): void {
  fighter.state = FighterState.KO;
  fighter.attack = null;
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.y = GROUND_Y;
}

// --- Push-apart -------------------------------------------------------------

function resolvePushCollision(world: SimWorld): void {
  const [p1, p2] = world.fighters;
  if (isAirborne(p1) || isAirborne(p2)) return;

  const dx = p2.x - p1.x;
  // Perfectly overlapping fighters are deliberately left alone: with dx at zero
  // there is no direction to separate them in.
  if (Math.abs(dx) >= PUSH_APART_DISTANCE || Math.abs(dx) < 0.01) return;

  const direction = dx >= 0 ? 1 : -1;
  const overlap = PUSH_APART_DISTANCE - Math.abs(dx);
  p1.x = clamp(p1.x - direction * overlap * 0.5, ARENA_MIN_X, ARENA_MAX_X);
  p2.x = clamp(p2.x + direction * overlap * 0.5, ARENA_MIN_X, ARENA_MAX_X);
}

// --- Combat -----------------------------------------------------------------

/** Kinds whose hitbox is tested on every active tick rather than fired once. */
const CONTINUOUS_KINDS = new Set([
  'melee', 'dash', 'slide', 'aura',
  'strike', 'multiStrike', 'antiAir', 'burst', 'counter', 'commandThrow', 'dashStrike',
]);

/** Kinds that send something across the arena. */
const PROJECTILE_KINDS = new Set(['sonic', 'water', 'salad', 'projectile', 'summon']);

/**
 * Kinds with no hitbox at all.
 *
 * They still occupy the fighter for their whole duration — that is the cost —
 * but they do their work through armour, invulnerability or meter rather than by
 * touching anyone. Listing them explicitly means a new kind that forgets to say
 * what it is falls through to the melee default and is visibly wrong, rather than
 * silently doing nothing.
 */
const NO_CONTACT_KINDS = new Set(['armor', 'parry', 'hide', 'install', 'meterCharge']);

function stepCombat(world: SimWorld, events: SimEvent[]): void {
  processAttack(world, 0, events);
  processAttack(world, 1, events);
  updateProjectiles(world, events);
  updateZones(world, events);
  updateUltimates(world, events);
}

function applyHitStop(world: SimWorld, ticks: number): void {
  world.hitStopTicks = Math.max(world.hitStopTicks, ticks);
}

function processAttack(world: SimWorld, attackerIndex: PlayerIndex, events: SimEvent[]): void {
  const attacker = world.fighters[attackerIndex];
  const defenderIndex: PlayerIndex = attackerIndex === 0 ? 1 : 0;
  const defender = world.fighters[defenderIndex];
  const attack = attacker.attack;
  if (!attack || isKO(attacker)) return;

  const spec = getSpec(attack.specId);

  if (attacker.state === FighterState.ULTIMATE && !attack.presented) {
    attack.presented = true;
    events.push({ t: 'ultimateStart', player: attackerIndex, specId: spec.id });
    /**
     * Freeze for the whole cut-in, not just a beat.
     *
     * The presentation is the render layer's job, but its *length* has to be the
     * simulation's: a pause that only stopped drawing would let the two clients
     * disagree about how many ticks the match advanced. So the cut-in reuses
     * hit-stop, and its duration comes from the ultimate's definition — derived
     * from the voice line, resolved to ticks at module load, never measured.
     */
    applyHitStop(world, ultimateDefinitionFor(attacker.configId).cutInTicks);
  }

  if (attackActive(attacker) && CONTINUOUS_KINDS.has(spec.kind)) {
    tryHit(world, attackerIndex, spec, () => getMeleeHitbox(attacker, spec), events);
  }

  if (!attack.activeJustStarted) return;
  if (CONTINUOUS_KINDS.has(spec.kind)) return;
  if (NO_CONTACT_KINDS.has(spec.kind)) return;

  if (PROJECTILE_KINDS.has(spec.kind)) {
    spawnProjectile(world, attackerIndex, spec, events);
    return;
  }

  if (spec.kind.startsWith('ultimate-')) {
    beginUltimate(world, attackerIndex, spec);
    return;
  }

  switch (spec.kind) {
    case 'zone':
      spawnZone(world, attackerIndex, defenderIndex, spec, events);
      break;
    case 'beam':
      fireBeam(world, attackerIndex, spec, events);
      break;
    default:
      tryHit(world, attackerIndex, spec, () => getMeleeHitbox(attacker, spec), events);
  }
}

// --- Ultimates --------------------------------------------------------------

/**
 * Start an ultimate's timeline.
 *
 * The owner's own attack is left running only until the timeline's `releaseTick`;
 * after that the boxes keep arriving on their own. That split is what the
 * upgraded build's `releaseOwnerControl` does, and it is why a super can cover a
 * hundred ticks without the fighter standing still for all of them.
 */
function beginUltimate(world: SimWorld, ownerIndex: PlayerIndex, spec: TickSpec): void {
  const owner = world.fighters[ownerIndex]!;
  const opponent = world.fighters[ownerIndex === 0 ? 1 : 0]!;
  const timeline = ultimateTimelineFor(owner.configId);

  // Paid on commitment, not on contact. Goblin's confession costs him whether or
  // not anybody was moved by it.
  if (timeline.selfDamage) {
    owner.hp = Math.max(1, owner.hp - timeline.selfDamage);
  }

  world.ultimates.push({
    ownerIndex,
    fighterId: owner.configId,
    specId: spec.id,
    elapsedTicks: 0,
    lockedTargetX: opponent.x,
    resolved: timeline.phases.map(() => false),
    // A grab decides on the first tick whether it caught anybody, and lives with
    // the answer. Deciding later would let the victim be dragged in by walking
    // toward a move that had already missed them.
    captured:
      timeline.capture !== undefined &&
      Math.abs(opponent.x - owner.x) <= timeline.capture.range &&
      !isAirborne(opponent) &&
      opponent.hp > 0,
  });
}

function updateUltimates(world: SimWorld, events: SimEvent[]): void {
  for (let i = world.ultimates.length - 1; i >= 0; i -= 1) {
    const ultimate = world.ultimates[i]!;

    /**
     * A knocked-out fighter's super stops with them.
     *
     * It could equally be argued the other way — the move was already paid for —
     * but a timeline that kept landing after its owner was on the floor would
     * also keep the victim in a capture they can no longer be released from by
     * anybody. Ending it is the version with no way to get stuck.
     */
    if (isKO(world.fighters[ultimate.ownerIndex]!)) {
      releaseCapture(world, ultimate);
      events.push({ t: 'ultimateEnd', player: ultimate.ownerIndex, specId: ultimate.specId });
      world.ultimates.splice(i, 1);
      continue;
    }

    ultimate.elapsedTicks += 1;
    advanceUltimate(world, ultimate, events);

    if (ultimate.elapsedTicks >= ultimateTimelineFor(ultimate.fighterId).ticks) {
      releaseCapture(world, ultimate);
      events.push({ t: 'ultimateEnd', player: ultimate.ownerIndex, specId: ultimate.specId });
      world.ultimates.splice(i, 1);
    }
  }
}

/** Let go of anyone this ultimate was holding, whatever ended it. */
function releaseCapture(world: SimWorld, ultimate: SimUltimate): void {
  if (!ultimate.captured) return;
  world.fighters[ultimate.ownerIndex === 0 ? 1 : 0]!.captureTicks = 0;
}

function advanceUltimate(world: SimWorld, ultimate: SimUltimate, events: SimEvent[]): void {
  const timeline = ultimateTimelineFor(ultimate.fighterId);
  const owner = world.fighters[ultimate.ownerIndex]!;
  const defenderIndex: PlayerIndex = ultimate.ownerIndex === 0 ? 1 : 0;
  const defender = world.fighters[defenderIndex]!;
  const tick = ultimate.elapsedTicks;

  if (tick === timeline.targetLockTick) ultimate.lockedTargetX = defender.x;

  // Control comes back part-way through, so the fighter can move while their own
  // super is still landing.
  if (tick === timeline.releaseTick && owner.attack?.specId === ultimate.specId) {
    owner.attack = null;
    if (!isKO(owner)) owner.state = FighterState.IDLE;
  }

  if (timeline.install && tick === timeline.install.atTick) {
    owner.installTicks = timeline.install.ticks;
  }

  if (timeline.capture && ultimate.captured) {
    // Re-applied every tick rather than set once, so the hold cannot be escaped
    // by anything that happens to clear the counter.
    if (tick >= timeline.capture.from && tick < timeline.capture.to && !isKO(defender)) {
      defender.captureTicks = 2;
    }
  }

  if (timeline.blink && tick >= timeline.blink.fromTick && tick <= timeline.blink.toTick) {
    if ((tick - timeline.blink.fromTick) % timeline.blink.everyTicks === 0) {
      const spread = timeline.blink.spreadX;
      owner.x = clampToArena(owner.x + nextInt(world.rng, -spread, spread));
    }
  }

  const spec = getSpec(ultimate.specId);
  for (let index = 0; index < timeline.phases.length; index += 1) {
    const phase = timeline.phases[index]!;
    if (ultimate.resolved[index]) continue;
    if (tick < phase.from || tick >= phase.from + phase.ticks) continue;
    // A grab that caught nobody swings at nothing for its whole duration.
    if (timeline.capture && !ultimate.captured) continue;

    const box = phaseBox(phase, owner, defender, ultimate.lockedTargetX);
    if (!rectsIntersect(box, getHurtbox(defender))) continue;

    const result = resolveUltimatePhase(world, ultimate, phase, spec, events);
    if (!result) continue;
    ultimate.resolved[index] = true;
    events.push({
      t: 'ultimatePhase',
      player: ultimate.ownerIndex,
      specId: ultimate.specId,
      seq: phase.seq,
      label: phase.label,
    });
  }
}

/**
 * Where a phase's box sits this tick.
 *
 * Pure in its inputs so it can be asked by a test without a world — the geometry
 * is the half of the upgraded build's timelines worth porting, and it should be
 * checkable on its own.
 */
export function phaseBox(
  phase: UltimatePhase,
  owner: SimFighter,
  defender: SimFighter,
  lockedTargetX: number,
): Rect {
  const anchorX =
    phase.anchor === 'arena' ? ARENA_MIN_X
    : phase.anchor === 'absolute' ? 0
    : phase.anchor === 'owner' ? owner.x
    : phase.anchor === 'opponent' ? defender.x
    : lockedTargetX;
  return {
    x: anchorX + phase.offsetX,
    y: phase.y,
    width: phase.width,
    height: phase.height,
  };
}

/**
 * Apply one phase, borrowing the ultimate's spec for everything the phase does
 * not name — knockback, meter, hit-stop — but overriding the damage and the
 * guard height, which are what make the beats different from one another.
 */
function resolveUltimatePhase(
  world: SimWorld,
  ultimate: SimUltimate,
  phase: UltimatePhase,
  spec: TickSpec,
  events: SimEvent[],
): boolean {
  const owner = world.fighters[ultimate.ownerIndex]!;
  const defenderIndex: PlayerIndex = ultimate.ownerIndex === 0 ? 1 : 0;
  const defender = world.fighters[defenderIndex]!;

  const phaseSpec: TickSpec = {
    ...spec,
    damage: phase.damage,
    hits: [phase.damage],
    attackType: phase.attackType,
  };
  const result = resolveHit(owner, defender, phaseSpec, world.tick, ultimate.ownerIndex, events);
  if (!result) return false;
  // Scaled to the beat rather than to the ultimate — see `ultimatePhaseHitStop`.
  // Hit-stop freezes the timeline along with everything else, so an over-generous
  // freeze here does not just feel wrong, it stretches the move.
  applyHitStop(world, result.blocked ? result.hitStopTicks : ultimatePhaseHitStop(phase.damage));
  return true;
}

function clampToArena(x: number): number {
  return x < ARENA_MIN_X ? ARENA_MIN_X : x > ARENA_MAX_X ? ARENA_MAX_X : x;
}

function hitBit(index: PlayerIndex): number {
  return index === 0 ? HIT_P1 : HIT_P2;
}

/**
 * Test an attacker's box against the defender and, if it lands, resolve it once.
 * The box is built lazily so the fullscreen ultimates can skip the geometry.
 */
function tryHit(
  world: SimWorld,
  attackerIndex: PlayerIndex,
  spec: TickSpec,
  box: () => { x: number; y: number; width: number; height: number },
  events: SimEvent[],
): void {
  const attacker = world.fighters[attackerIndex];
  const defenderIndex: PlayerIndex = attackerIndex === 0 ? 1 : 0;
  const defender = world.fighters[defenderIndex];
  const attack = attacker.attack;
  if (!attack) return;

  const bit = hitBit(defenderIndex);
  if ((attack.hitMask & bit) !== 0) {
    // Already connected. A multi-hit attack gets its mask cleared once the rehit
    // gap has passed and it still has hits left to give.
    const exhausted = attack.hitsUsed >= spec.hits.length;
    if (exhausted || world.tick < attack.rehitReadyTick) return;
    attack.hitMask &= ~bit;
  }
  if (!rectsIntersect(box(), getHurtbox(defender))) return;

  const result = resolveHit(attacker, defender, spec, world.tick, attackerIndex, events);
  // A refused hit — invulnerable, or a throw against an airborne defender —
  // leaves the mask alone, so the attack can still land later in its active
  // window rather than being spent on a target it never touched.
  if (!result) return;

  attack.hitMask |= bit;
  attack.hitsUsed += 1;
  attack.rehitReadyTick = world.tick + spec.rehitTicks;
  // Recorded on the attack so the cancel window knows the move earned its way in.
  // An armoured hit still counts as a hit: the attacker connected, the defender
  // merely refused to be interrupted by it.
  attack.result = result.blocked ? 'block' : 'hit';
  applyHitStop(world, result.hitStopTicks);
}

// --- Projectiles ------------------------------------------------------------

const PROJECTILE_SPAWN_OFFSET_X = 70;
const PROJECTILE_SPAWN_Y = 118;
/** Despawn margin outside the screen. */
const PROJECTILE_DESPAWN_MARGIN = 100;

function projectileSize(kind: string): { width: number; height: number } {
  if (kind === 'water') return { width: 118, height: 34 };
  if (kind === 'salad') return { width: 76, height: 54 };
  return { width: 90, height: 46 };
}

/**
 * How far apart the members of a summoned column stand.
 *
 * They are spaced behind the caster rather than staggered in time, so the whole
 * column exists from the first tick and can be hashed and rolled back without a
 * spawn schedule to keep in step.
 */
const SUMMON_SPACING_X = 74;

function spawnProjectile(
  world: SimWorld,
  ownerIndex: PlayerIndex,
  spec: TickSpec,
  events: SimEvent[],
): void {
  const owner = world.fighters[ownerIndex];
  const { width, height } = projectileSize(spec.kind);

  for (let index = 0; index < spec.projectileCount; index += 1) {
    const projectile: SimProjectile = {
      id: world.nextEntityId++,
      ownerIndex,
      specId: spec.id,
      // Each one starts a little further back, so a summon arrives as a column
      // rather than as a single wide hitbox.
      x: owner.x + owner.facing * (PROJECTILE_SPAWN_OFFSET_X - index * SUMMON_SPACING_X),
      y: owner.y - PROJECTILE_SPAWN_Y,
      vx: owner.facing * spec.projectileSpeed,
      width,
      height,
      lifeTicks: spec.lifetimeTicks,
      hitMask: 0,
    };
    world.projectiles.push(projectile);
    events.push({
      t: 'projectileSpawn',
      id: projectile.id,
      player: ownerIndex,
      specId: spec.id,
      x: projectile.x,
      y: projectile.y,
    });
  }
}

function updateProjectiles(world: SimWorld, events: SimEvent[]): void {
  const survivors: SimProjectile[] = [];

  for (const projectile of world.projectiles) {
    projectile.lifeTicks -= 1;
    projectile.x += projectile.vx * DT;

    const targetIndex: PlayerIndex = projectile.ownerIndex === 0 ? 1 : 0;
    const target = world.fighters[targetIndex];
    const bit = hitBit(targetIndex);
    const box = {
      x: projectile.x - projectile.width / 2,
      y: projectile.y - projectile.height / 2,
      width: projectile.width,
      height: projectile.height,
    };

    if (
      (projectile.hitMask & bit) === 0 &&
      !isKO(target) &&
      rectsIntersect(box, getHurtbox(target))
    ) {
      projectile.hitMask |= bit;
      const spec = getSpec(projectile.specId);
      const result = resolveHit(
        world.fighters[projectile.ownerIndex],
        target,
        spec,
        world.tick,
        projectile.ownerIndex,
        events,
      );
      if (result) applyHitStop(world, result.hitStopTicks);
      events.push({ t: 'projectileEnd', id: projectile.id });
      continue;
    }

    if (
      projectile.lifeTicks <= 0 ||
      projectile.x < -PROJECTILE_DESPAWN_MARGIN ||
      projectile.x > GAME_WIDTH + PROJECTILE_DESPAWN_MARGIN
    ) {
      events.push({ t: 'projectileEnd', id: projectile.id });
      continue;
    }

    survivors.push(projectile);
  }

  world.projectiles = survivors;
}

// --- Zones ------------------------------------------------------------------

/** How far ahead of the defender a zone is placed, as a share of their velocity. */
const ZONE_LEAD_FACTOR = 0.15;
const ZONE_HIT_RADIUS = 100;
/** A target jumping higher than this clears the zone. */
const ZONE_MAX_HEIGHT = 250;

function spawnZone(
  world: SimWorld,
  ownerIndex: PlayerIndex,
  defenderIndex: PlayerIndex,
  spec: TickSpec,
  events: SimEvent[],
): void {
  const defender = world.fighters[defenderIndex];
  // Placed relative to the *defender*, leading their current movement — the only
  // attack whose spawn position depends on the opponent.
  const x = clamp(defender.x + defender.vx * ZONE_LEAD_FACTOR, 120, GAME_WIDTH - 120);
  pushZone(world, ownerIndex, spec, x, spec.telegraphTicks, spec.zoneDurationTicks, events);
}

function pushZone(
  world: SimWorld,
  ownerIndex: PlayerIndex,
  spec: TickSpec,
  x: number,
  timerTicks: number,
  activeTicks: number,
  events: SimEvent[],
): void {
  const zone: SimZone = {
    id: world.nextEntityId++,
    ownerIndex,
    specId: spec.id,
    x,
    timerTicks,
    activeTicks,
    triggered: false,
    hitMask: 0,
  };
  world.zones.push(zone);
  events.push({ t: 'zoneSpawn', id: zone.id, player: ownerIndex, specId: spec.id, x });
}

function updateZones(world: SimWorld, events: SimEvent[]): void {
  const survivors: SimZone[] = [];

  for (const zone of world.zones) {
    const targetIndex: PlayerIndex = zone.ownerIndex === 0 ? 1 : 0;
    const target = world.fighters[targetIndex];
    const spec = getSpec(zone.specId);

    if (!zone.triggered) {
      zone.timerTicks -= 1;
      if (zone.timerTicks <= 0) {
        zone.triggered = true;
        events.push({ t: 'zoneTrigger', id: zone.id });
      }
      survivors.push(zone);
      continue;
    }

    zone.activeTicks -= 1;
    const hurtbox = getHurtbox(target);
    const inZone =
      Math.abs(target.x - zone.x) < ZONE_HIT_RADIUS &&
      hurtbox.y + hurtbox.height > GROUND_Y - ZONE_MAX_HEIGHT;
    const bit = hitBit(targetIndex);

    if (inZone && (zone.hitMask & bit) === 0) {
      zone.hitMask |= bit;
      const result = resolveHit(
        world.fighters[zone.ownerIndex],
        target,
        spec,
        world.tick,
        zone.ownerIndex,
        events,
      );
      if (result) applyHitStop(world, result.hitStopTicks);
    }

    if (zone.activeTicks <= 0) {
      events.push({ t: 'zoneEnd', id: zone.id });
      continue;
    }
    survivors.push(zone);
  }

  world.zones = survivors;
}

// --- Beam -------------------------------------------------------------------

const BEAM_OFFSET_X = 45;
const BEAM_CENTER_Y = 122;
const BEAM_HIT_HEIGHT = 60;

function fireBeam(
  world: SimWorld,
  attackerIndex: PlayerIndex,
  spec: TickSpec,
  events: SimEvent[],
): void {
  const attacker = world.fighters[attackerIndex];
  const width = spec.reach;
  const centerX =
    attacker.facing > 0
      ? attacker.x + width / 2 + BEAM_OFFSET_X
      : attacker.x - width / 2 - BEAM_OFFSET_X;
  const centerY = attacker.y - BEAM_CENTER_Y;

  events.push({ t: 'beam', player: attackerIndex, specId: spec.id, x: centerX, y: centerY, width });
  tryHit(world, attackerIndex, spec, () => ({
    x: centerX - width / 2,
    y: centerY - BEAM_HIT_HEIGHT / 2,
    width,
    height: BEAM_HIT_HEIGHT,
  }), events);
}

// --- Checksum ---------------------------------------------------------------

/**
 * A 32-bit fingerprint of the entire world, exchanged between clients every 60
 * ticks to detect a desync.
 *
 * Every field that can diverge must be folded in. Anything omitted here is a
 * divergence that goes unreported until the two screens visibly disagree, which
 * is far harder to debug than a checksum mismatch with a tick number attached.
 */
export function checksum(world: SimWorld): number {
  let h = HASH_SEED;

  h = hashInt(h, world.tick);
  h = hashString(h, world.phase);
  h = hashInt(h, world.phaseTicks);
  h = hashInt(h, world.roundNumber);
  h = hashInt(h, world.roundTicksRemaining);
  h = hashInt(h, world.hitStopTicks);
  h = hashInt(h, world.roundWins[0]);
  h = hashInt(h, world.roundWins[1]);
  h = hashInt(h, world.matchWinner ?? -1);
  h = hashInt(h, world.nextEntityId);
  h = hashInt(h, world.rng.state);

  for (const fighter of world.fighters) {
    h = hashString(h, fighter.configId);
    h = hashString(h, fighter.state);
    h = hashFloat(h, fighter.hp);
    h = hashFloat(h, fighter.energy);
    h = hashFloat(h, fighter.x);
    h = hashFloat(h, fighter.y);
    h = hashFloat(h, fighter.vx);
    h = hashFloat(h, fighter.vy);
    h = hashInt(h, fighter.facing);
    h = hashInt(h, fighter.stateRemainingTicks);
    h = hashFloat(h, fighter.nextSpecialTick);
    h = hashFloat(h, fighter.stunLockoutUntilTick);
    h = hashBool(h, fighter.guardHeld);
    h = hashBool(h, fighter.guardCrouching);
    h = hashInt(h, fighter.dashTicks);
    h = hashInt(h, fighter.nextParryTick);
    h = hashInt(h, fighter.prevButtons);
    h = hashInt(h, fighter.downBufferedUntilTick);
    h = hashInt(h, fighter.chargeTicks);
    h = hashInt(h, fighter.installTicks);
    h = hashInt(h, fighter.slowTicks);

    // The command ring decides whether a motion input has been completed, so two
    // clients holding different histories would disagree about which move comes
    // out. Hashed by absolute slot including the head, not by recent-first order:
    // two rings holding the same inputs at different rotations are not the same
    // state, and the next write would land in a different place.
    h = hashInt(h, fighter.commandHistory.head);
    for (const frame of fighter.commandHistory.frames) h = hashInt(h, frame);

    const attack = fighter.attack;
    h = hashBool(h, attack !== null);
    if (attack) {
      h = hashString(h, attack.specId);
      h = hashInt(h, attack.elapsedTicks);
      h = hashBool(h, attack.activeJustStarted);
      h = hashBool(h, attack.crouching);
      h = hashBool(h, attack.airborne);
      h = hashInt(h, attack.hitMask);
      h = hashBool(h, attack.presented);
      /**
       * The four fields below all decide what happens next — how much damage the
       * next connect deals, when it may land, whether armour is spent, and whether
       * a cancel is allowed — so two clients disagreeing about any of them diverge.
       * They were missing, which made that divergence one nothing would report.
       */
      h = hashInt(h, attack.hitsUsed);
      h = hashInt(h, attack.rehitReadyTick);
      h = hashInt(h, attack.armorUsed);
      h = hashString(h, attack.result);
    }
  }

  /**
   * Ultimates in flight. Each one carries a locked target, a per-phase hit record
   * and whether its grab caught anybody — all of which decide damage that has not
   * been dealt yet, so two clients disagreeing about any of it diverge silently.
   */
  for (const ultimate of world.ultimates) {
    h = hashInt(h, ultimate.ownerIndex);
    h = hashString(h, ultimate.specId);
    h = hashInt(h, ultimate.elapsedTicks);
    h = hashFloat(h, ultimate.lockedTargetX);
    h = hashBool(h, ultimate.captured);
    for (const resolved of ultimate.resolved) h = hashBool(h, resolved);
  }

  for (const projectile of world.projectiles) {
    h = hashInt(h, projectile.id);
    h = hashInt(h, projectile.ownerIndex);
    h = hashString(h, projectile.specId);
    h = hashFloat(h, projectile.x);
    h = hashFloat(h, projectile.y);
    h = hashFloat(h, projectile.vx);
    h = hashInt(h, projectile.lifeTicks);
    h = hashInt(h, projectile.hitMask);
  }

  for (const zone of world.zones) {
    h = hashInt(h, zone.id);
    h = hashInt(h, zone.ownerIndex);
    h = hashString(h, zone.specId);
    h = hashFloat(h, zone.x);
    h = hashInt(h, zone.timerTicks);
    h = hashInt(h, zone.activeTicks);
    h = hashBool(h, zone.triggered);
    h = hashInt(h, zone.hitMask);
  }

  return finalizeHash(h);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Re-exported so callers do not need to reach into combat.ts for one predicate. */
export { canBlockImpact, impactWeight };
