import { FighterState } from '../fighters/FighterState';
import { getSpec } from './attackSpecs';
import { MAX_ENERGY, msToTicks } from './constants';
import { canUseSpecial, config, isAirborne } from './fighter';
import { BUTTON, EMPTY_INPUT, type InputFrame } from './input';
import { nextFloat, nextInt, type Rng } from './rng';
import type { PlayerIndex, SimWorld } from './types';

/**
 * The finite-state CPU, ported from CPUController.
 *
 * Two changes beyond the mechanical port:
 *
 * 1. Every `Math.random()` — there were seven — is now a draw from a seeded
 *    generator, so a 1P match replays exactly and can be captured as a golden
 *    replay fixture.
 * 2. It emits raw button frames rather than a derived intent, because the
 *    simulation now computes press edges itself. That means the brain has to
 *    *release* an attack button after using it; holding it down would fire once
 *    and then do nothing.
 *
 * The brain's own timers live here rather than in SimWorld: online play has no
 * CPU, and a replay records the frames it emitted, so nothing is lost by keeping
 * it outside the snapshot.
 */

export type CpuDifficulty = 'easy' | 'normal' | 'hard';

interface DifficultyTuning {
  minDecisionTicks: number;
  maxDecisionTicks: number;
  blockChance: number;
  specialChance: number;
  heavyChance: number;
  jumpChance: number;
  /**
   * How likely a special is committed to as a long charge rather than tapped out
   * at level 1.
   *
   * A full charge is expensive — the fighter stands still for up to a second and
   * cannot block — so this is what difficulty buys: easy never commits, hard often
   * does. Tuned down from "always charge", which had the hard CPU winding up for
   * two thirds of the match and made it *easier* to fight, not harder.
   */
  chargeCommitChance: number;
  minChargeTicks: number;
  maxChargeTicks: number;
  /**
   * How often a block is a *low* block.
   *
   * A guess, never a read. Reading the incoming attack's height would make the
   * CPU unbeatable by the mix-up, which is the opposite of a difficulty knob —
   * it removes an interaction rather than tightening one. What difficulty buys
   * here is a guess closer to even: an easy CPU stands almost always and so eats
   * every sweep, a hard one splits its guard and has to be genuinely mixed up.
   */
  crouchBlockChance: number;
}

const TUNING: Record<CpuDifficulty, DifficultyTuning> = {
  easy: {
    minDecisionTicks: msToTicks(430), maxDecisionTicks: msToTicks(560),
    blockChance: 0.2, specialChance: 0.15, heavyChance: 0.18, jumpChance: 0.08,
    chargeCommitChance: 0, minChargeTicks: 20, maxChargeTicks: 30,
    crouchBlockChance: 0.15,
  },
  normal: {
    minDecisionTicks: msToTicks(280), maxDecisionTicks: msToTicks(360),
    blockChance: 0.4, specialChance: 0.32, heavyChance: 0.3, jumpChance: 0.13,
    chargeCommitChance: 0.3, minChargeTicks: 26, maxChargeTicks: 44,
    crouchBlockChance: 0.3,
  },
  hard: {
    minDecisionTicks: msToTicks(165), maxDecisionTicks: msToTicks(225),
    blockChance: 0.6, specialChance: 0.45, heavyChance: 0.38, jumpChance: 0.18,
    chargeCommitChance: 0.5, minChargeTicks: 30, maxChargeTicks: 62,
    crouchBlockChance: 0.45,
  },
};

/** Direction bits survive a hold; action bits are released after one tick. */
const MOVEMENT_MASK = BUTTON.Left | BUTTON.Right | BUTTON.Down;

const OPPONENT_ATTACK_STATES = new Set([
  FighterState.LIGHT_ATTACK,
  FighterState.HEAVY_ATTACK,
  FighterState.SPECIAL,
  FighterState.ULTIMATE,
]);

export class CpuBrain {
  private nextDecisionTick = 0;
  private holdUntilTick = 0;
  private chargeUntilTick = 0;
  private current: InputFrame = EMPTY_INPUT;

  constructor(
    private readonly selfIndex: PlayerIndex,
    private readonly difficulty: CpuDifficulty,
    private readonly rng: Rng,
  ) {}

  reset(): void {
    this.nextDecisionTick = 0;
    this.holdUntilTick = 0;
    this.chargeUntilTick = 0;
    this.current = EMPTY_INPUT;
  }

  decide(world: SimWorld): InputFrame {
    const self = world.fighters[this.selfIndex];
    const opponent = world.fighters[this.selfIndex === 0 ? 1 : 0];
    const tick = world.tick;

    /**
     * Charging is the one hold that must *not* release the button, because it is
     * the release that fires the move. Checked before the ordinary hold, whose
     * whole job is the opposite.
     *
     * If the charge was interrupted — a hit landed, and `H_CHARGING` is gone —
     * there is nothing left to hold for, so stop and decide afresh.
     */
    if (tick < this.chargeUntilTick) {
      if (self.state === FighterState.H_CHARGING) return BUTTON.Special;
      this.chargeUntilTick = 0;
    }

    // While holding, keep walking or crouching but let go of the action buttons,
    // so the next press registers as a fresh edge.
    if (tick < this.holdUntilTick || tick < this.nextDecisionTick) {
      return this.current & MOVEMENT_MASK;
    }

    const tuning = TUNING[this.difficulty];
    this.nextDecisionTick = tick + this.randomTicks(tuning.minDecisionTicks, tuning.maxDecisionTicks);

    const distance = Math.abs(opponent.x - self.x);
    const toward = opponent.x > self.x ? BUTTON.Right : BUTTON.Left;
    const away = toward === BUTTON.Right ? BUTTON.Left : BUTTON.Right;
    const opponentAttacking = OPPONENT_ATTACK_STATES.has(opponent.state);
    const ranged = config(self).rangeStat >= 4;

    let frame: InputFrame = EMPTY_INPUT;

    if (opponentAttacking && distance < 270 && nextFloat(this.rng) < tuning.blockChance) {
      /**
       * Guess a height rather than always standing.
       *
       * Not a read of the incoming move — that would be a CPU that never loses
       * the mix-up, which is not an opponent, it is a wall. But it cannot be a
       * pure stand either: once crouching normals existed, a CPU that only ever
       * stand-blocked made every low in the game unblockable against it, and the
       * whole high/low layer became a free hit in single player.
       *
       * So it guesses, and `crouchBlockChance` is how often it guesses low.
       */
      frame = away;
      if (nextFloat(this.rng) < tuning.crouchBlockChance) frame |= BUTTON.Down;
      this.holdUntilTick = tick + this.randomTicks(msToTicks(160), msToTicks(310));
    } else if (self.energy >= MAX_ENERGY && distance < 560 && nextFloat(this.rng) < 0.7) {
      /**
       * The CPU asks for the ultimate directly rather than acting out the hold,
       * release and second press a human goes through. The delivered notes call
       * that out: the meter protocol is an input protocol, not a CPU one, and both
       * arrive at the same move from there.
       */
      frame = BUTTON.Ultimate;
      this.holdUntilTick = tick + msToTicks(130);
    } else if (
      canUseSpecial(self, tick) &&
      this.specialDistanceGood(world, distance) &&
      nextFloat(this.rng) < tuning.specialChance
    ) {
      // Hold it: the release is what fires the charge, and how long it is held is
      // what decides the level. Most specials are tapped straight out at level 1;
      // committing to a long wind-up is the exception.
      frame = BUTTON.Special;
      this.chargeUntilTick =
        nextFloat(this.rng) < tuning.chargeCommitChance
          ? tick + this.randomTicks(tuning.minChargeTicks, tuning.maxChargeTicks)
          : tick + this.randomTicks(2, 8);
    } else if (distance < 125) {
      frame = nextFloat(this.rng) < tuning.heavyChance ? BUTTON.Heavy : BUTTON.Light;
      this.holdUntilTick = tick + this.randomTicks(msToTicks(100), msToTicks(220));
    } else if (isAirborne(opponent) && distance < 220 && nextFloat(this.rng) < 0.45) {
      frame = BUTTON.Heavy;
    } else if (ranged && distance < 210) {
      frame = away;
      this.holdUntilTick = tick + this.randomTicks(msToTicks(180), msToTicks(340));
    } else if (distance > (ranged ? 380 : 150)) {
      frame = toward;
      this.holdUntilTick = tick + this.randomTicks(msToTicks(160), msToTicks(360));
    } else if (nextFloat(this.rng) < tuning.jumpChance) {
      frame = BUTTON.Up;
    } else if (ranged) {
      frame = away;
      this.holdUntilTick = tick + this.randomTicks(msToTicks(100), msToTicks(240));
    }

    this.current = frame;
    return frame;
  }

  private specialDistanceGood(world: SimWorld, distance: number): boolean {
    const self = world.fighters[this.selfIndex];
    switch (getSpec(config(self).specials.quarterForward.id).kind) {
      case 'dash':
      case 'slide':
        return distance >= 120 && distance <= 330;
      case 'aura':
        return distance <= 260;
      case 'zone':
        return distance >= 160 && distance <= 700;
      case 'beam':
        return distance >= 220;
      default:
        return distance >= 130 && distance <= 600;
    }
  }

  private randomTicks(min: number, max: number): number {
    return nextInt(this.rng, min, max + 1);
  }
}
