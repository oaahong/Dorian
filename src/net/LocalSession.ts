import { EMPTY_INPUT, INPUT_FRAME_MASK, type InputFrame } from '../sim/input';
import type { PlayerIndex } from '../sim/types';
import type { Session, SessionStatus } from './Session';

/**
 * The offline implementation of {@link Session}: nothing to wait for.
 *
 * It exists so BattleScene has exactly one way of getting a tick's inputs
 * regardless of mode. Hot-seat, versus-CPU and online all go through the same
 * call, which means switching to online is a change of session, not a change to
 * the game loop.
 *
 * The opponent's frame is pulled through a callback rather than pushed in,
 * because the two sources behave differently: a second keyboard must be sampled
 * once per tick, and the CPU brain advances its own timers when asked. Both are
 * called exactly once per tick, and the result is cached so a repeated query for
 * the same tick cannot double-advance the AI.
 */
export class LocalSession implements Session {
  readonly localPlayer: PlayerIndex = 0;
  readonly inputDelay = 0;

  private localFrame: InputFrame = EMPTY_INPUT;
  private localTick = -1;
  private opponentFrame: InputFrame = EMPTY_INPUT;
  private opponentTick = -1;

  constructor(private readonly opponentInput: (tick: number) => InputFrame) {}

  get status(): SessionStatus {
    return 'ok';
  }

  submitLocalInput(tick: number, input: InputFrame): void {
    this.localTick = tick;
    this.localFrame = input & INPUT_FRAME_MASK;
  }

  inputsForTick(tick: number): [InputFrame, InputFrame] {
    if (this.opponentTick !== tick) {
      this.opponentTick = tick;
      this.opponentFrame = this.opponentInput(tick) & INPUT_FRAME_MASK;
    }
    const local = this.localTick === tick ? this.localFrame : EMPTY_INPUT;
    return [local, this.opponentFrame];
  }
}
