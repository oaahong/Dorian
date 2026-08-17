import { FIGHTERS } from '../fighters/fighterData';
import type { CpuDifficulty } from '../sim/cpu';

/**
 * `training` is `pvp` with the second seat left idle and the clock under the
 * player's control — a mode rather than a scene, because everything about the match
 * itself is identical and a second BattleScene would drift from the first.
 */
export type GameMode = 'cpu' | 'pvp' | 'online' | 'training';
export type StageId = 'freezer' | 'magicForest' | 'diningTable';
export type { CpuDifficulty };

export interface MatchState {
  mode: GameMode;
  difficulty: CpuDifficulty;
  p1Character: string;
  p2Character: string;
  p1RoundWins: number;
  p2RoundWins: number;
  stage: StageId;
  matchWinner: 1 | 2 | null;
  /**
   * Seeds the simulation's RNG. Rolled once when a match is set up, so a match is
   * reproducible from (seed, characters, stage, inputs) alone. Online, the host
   * picks it and sends it in `match_start`; both clients must use the same value
   * or their CPU-free worlds still agree but their replays would not.
   */
  seed: number;
}

const STAGES: StageId[] = ['freezer', 'magicForest', 'diningTable'];

class GameStateStore {
  data: MatchState = {
    mode: 'cpu',
    difficulty: 'normal',
    p1Character: FIGHTERS[0]!.id,
    p2Character: FIGHTERS[7]!.id,
    p1RoundWins: 0,
    p2RoundWins: 0,
    stage: 'freezer',
    matchWinner: null,
    seed: 1,
  };

  /**
   * Whether the second seat is chosen by a player rather than handed out.
   *
   * `pvp` and `training` both let P2 be picked; `cpu` randomises the opponent and
   * `online` gets it from the room. Named rather than spelled out at each of the six
   * places the select screen asks, because the fourth mode is exactly the point at
   * which a list of `||`s starts getting one branch wrong.
   */
  picksBothFighters(): boolean {
    return this.data.mode === 'pvp' || this.data.mode === 'training';
  }

  /** Training leaves the second seat idle and hands the clock to the player. */
  get isTraining(): boolean {
    return this.data.mode === 'training';
  }

  resetMatch(): void {
    this.data.p1RoundWins = 0;
    this.data.p2RoundWins = 0;
    this.data.matchWinner = null;
  }

  /**
   * Roll the values that decide the shape of a match. This is menu-level setup,
   * so `Math.random` is fine here — it never runs inside the simulation, and
   * online the host will send these across instead of rolling them locally.
   */
  rollMatchSetup(): void {
    this.data.stage = STAGES[Math.floor(Math.random() * STAGES.length)]!;
    this.data.seed = (Math.random() * 0xffffffff) >>> 0;
  }

  /** Pick a CPU opponent that is not the player's own choice. */
  pickCpuOpponent(excludeIndex: number): string {
    const candidates = FIGHTERS.filter((_, index) => index !== excludeIndex);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return (pick ?? FIGHTERS[(excludeIndex + 1) % FIGHTERS.length]!).id;
  }
}

export const gameState = new GameStateStore();
