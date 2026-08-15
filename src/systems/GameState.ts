import { FIGHTERS } from '../fighters/fighterData';

export type GameMode = 'cpu' | 'pvp';
export type CpuDifficulty = 'easy' | 'normal' | 'hard';
export type StageId = 'freezer' | 'magicForest' | 'diningTable';

export interface MatchState {
  mode: GameMode;
  difficulty: CpuDifficulty;
  p1Character: string;
  p2Character: string;
  p1RoundWins: number;
  p2RoundWins: number;
  stage: StageId;
  matchWinner: 1 | 2 | null;
}

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
  };

  resetMatch(): void {
    this.data.p1RoundWins = 0;
    this.data.p2RoundWins = 0;
    this.data.matchWinner = null;
  }

  randomizeStage(): void {
    const stages: StageId[] = ['freezer', 'magicForest', 'diningTable'];
    this.data.stage = stages[Math.floor(Math.random() * stages.length)]!;
  }
}

export const gameState = new GameStateStore();
