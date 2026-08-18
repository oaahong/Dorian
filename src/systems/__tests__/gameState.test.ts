import { describe, it, expect } from 'vitest';
import { gameState } from '../GameState';
import type { GameMode } from '../GameState';

/**
 * The two mode predicates the scenes branch on.
 *
 * Worth their own tests because the select screen asks `picksBothFighters` in six
 * places, and a fourth mode is exactly the point at which a list of `||`s starts
 * getting one branch wrong.
 */

const withMode = <T>(mode: GameMode, run: () => T): T => {
  const previous = gameState.data.mode;
  gameState.data.mode = mode;
  try {
    return run();
  } finally {
    gameState.data.mode = previous;
  }
};

describe('picksBothFighters', () => {
  it('is true where a second player chooses', () => {
    for (const mode of ['pvp', 'training'] as const) {
      expect(withMode(mode, () => gameState.picksBothFighters()), mode).toBe(true);
    }
  });

  it('is false where the second fighter is handed out', () => {
    // `cpu` randomises the opponent; `online` takes it from the room.
    for (const mode of ['cpu', 'online'] as const) {
      expect(withMode(mode, () => gameState.picksBothFighters()), mode).toBe(false);
    }
  });
});

describe('isTraining', () => {
  it('is true only for training', () => {
    const modes: GameMode[] = ['cpu', 'pvp', 'online', 'training'];
    for (const mode of modes) {
      expect(withMode(mode, () => gameState.isTraining), mode).toBe(mode === 'training');
    }
  });
});
