import type { PlayerIndex } from '../sim/types';
import type { LockstepSession } from './LockstepSession';
import type { OnlineClient } from './OnlineClient';

/**
 * The connection handed from the lobby to the battle.
 *
 * Phaser scenes are constructed by the framework and cannot take arguments, so
 * the lobby leaves the live session here for BattleScene to pick up — the same
 * pattern `gameState` already uses for the rest of the match setup.
 */
export interface ActiveOnlineMatch {
  client: OnlineClient;
  session: LockstepSession;
  seat: PlayerIndex;
}

export const onlineMatch: { current: ActiveOnlineMatch | null } = { current: null };

/** Tear down whatever connection is live. Safe to call when there is none. */
export function endOnlineMatch(): void {
  onlineMatch.current?.client.close();
  onlineMatch.current = null;
}
