import type { Controller, FighterIntent } from './Controller';
import { EMPTY_INTENT } from './Controller';
import type { CpuDifficulty } from '../systems/GameState';
import type { Fighter } from '../fighters/Fighter';
import { FighterState } from '../fighters/FighterState';

interface DifficultyTuning {
  minDecisionMs: number;
  maxDecisionMs: number;
  blockChance: number;
  specialChance: number;
  heavyChance: number;
  jumpChance: number;
}

const TUNING: Record<CpuDifficulty, DifficultyTuning> = {
  easy: { minDecisionMs: 430, maxDecisionMs: 560, blockChance: .20, specialChance: .15, heavyChance: .18, jumpChance: .08 },
  normal: { minDecisionMs: 280, maxDecisionMs: 360, blockChance: .40, specialChance: .32, heavyChance: .30, jumpChance: .13 },
  hard: { minDecisionMs: 165, maxDecisionMs: 225, blockChance: .60, specialChance: .45, heavyChance: .38, jumpChance: .18 },
};

export class CPUController implements Controller {
  private nextDecisionAt = 0;
  private holdUntil = 0;
  private current: FighterIntent = { ...EMPTY_INTENT };

  constructor(
    private readonly self: Fighter,
    private readonly opponent: Fighter,
    private readonly difficulty: CpuDifficulty,
  ) {}

  update(nowMs: number): FighterIntent {
    if (nowMs < this.holdUntil) return { ...this.current, jumpPressed:false, lightPressed:false, heavyPressed:false, specialPressed:false, ultimatePressed:false };
    if (nowMs < this.nextDecisionAt) return { ...this.current, jumpPressed:false, lightPressed:false, heavyPressed:false, specialPressed:false, ultimatePressed:false };

    const tuning = TUNING[this.difficulty];
    this.nextDecisionAt = nowMs + this.random(tuning.minDecisionMs, tuning.maxDecisionMs);
    const distance = Math.abs(this.opponent.x - this.self.x);
    const toward = this.opponent.x > this.self.x ? 1 : -1;
    const away = -toward;
    const opponentAttacking = [FighterState.LIGHT_ATTACK, FighterState.HEAVY_ATTACK, FighterState.SPECIAL, FighterState.ULTIMATE].includes(this.opponent.state);
    const ranged = this.self.config.rangeStat >= 4;
    const intent: FighterIntent = { ...EMPTY_INTENT };

    if (opponentAttacking && distance < 270 && Math.random() < tuning.blockChance) {
      intent.move = away as -1 | 1;
      this.holdUntil = nowMs + this.random(160, 310);
    } else if (this.self.memeEnergy >= 100 && distance < 560 && Math.random() < .70) {
      intent.ultimatePressed = true;
      this.holdUntil = nowMs + 130;
    } else if (this.self.canUseSpecial(nowMs) && this.specialDistanceGood(distance) && Math.random() < tuning.specialChance) {
      intent.specialPressed = true;
      this.holdUntil = nowMs + 120;
    } else if (distance < 125) {
      if (Math.random() < tuning.heavyChance) intent.heavyPressed = true;
      else intent.lightPressed = true;
      this.holdUntil = nowMs + this.random(100, 220);
    } else if (this.opponent.isAirborne && distance < 220 && Math.random() < .45) {
      intent.heavyPressed = true;
    } else if (ranged && distance < 210) {
      intent.move = away as -1 | 1;
      this.holdUntil = nowMs + this.random(180, 340);
    } else if (distance > (ranged ? 380 : 150)) {
      intent.move = toward as -1 | 1;
      this.holdUntil = nowMs + this.random(160, 360);
    } else if (Math.random() < tuning.jumpChance) {
      intent.jumpPressed = true;
    } else if (ranged) {
      intent.move = away as -1 | 1;
      this.holdUntil = nowMs + this.random(100, 240);
    }

    this.current = intent;
    return { ...intent };
  }

  reset(): void {
    this.nextDecisionAt = 0;
    this.holdUntil = 0;
    this.current = { ...EMPTY_INTENT };
  }

  private specialDistanceGood(distance: number): boolean {
    switch (this.self.config.special.kind) {
      case 'dash': case 'slide': return distance >= 120 && distance <= 330;
      case 'aura': return distance <= 260;
      case 'zone': return distance >= 160 && distance <= 700;
      case 'beam': return distance >= 220;
      default: return distance >= 130 && distance <= 600;
    }
  }

  private random(min: number, max: number): number { return min + Math.random() * (max - min); }
}
