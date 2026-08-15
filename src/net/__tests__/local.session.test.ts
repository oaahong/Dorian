import { describe, it, expect, vi } from 'vitest';
import { BUTTON, EMPTY_INPUT } from '../../sim/input';
import { LocalSession } from '../LocalSession';

describe('LocalSession', () => {
  it('never makes the simulation wait', () => {
    const session = new LocalSession(() => EMPTY_INPUT);
    expect(session.inputsForTick(0)).not.toBeNull();
    expect(session.status).toBe('ok');
    expect(session.inputDelay).toBe(0);
  });

  it('applies the local frame on the same tick it was sampled', () => {
    const session = new LocalSession(() => BUTTON.Left);
    session.submitLocalInput(5, BUTTON.Right);
    expect(session.inputsForTick(5)).toEqual([BUTTON.Right, BUTTON.Left]);
  });

  it('falls back to neutral if no frame was offered for the tick', () => {
    const session = new LocalSession(() => BUTTON.Left);
    session.submitLocalInput(4, BUTTON.Right);
    expect(session.inputsForTick(5)).toEqual([EMPTY_INPUT, BUTTON.Left]);
  });

  it('asks the opponent source exactly once per tick', () => {
    /**
     * The CPU brain advances its own decision timers when asked, so querying it
     * twice for one tick would make it act at double speed — and a second
     * keyboard would have its tap latch cleared twice.
     */
    const opponent = vi.fn(() => BUTTON.Heavy);
    const session = new LocalSession(opponent);

    session.inputsForTick(7);
    session.inputsForTick(7);
    expect(opponent).toHaveBeenCalledTimes(1);

    session.inputsForTick(8);
    expect(opponent).toHaveBeenCalledTimes(2);
  });

  it('masks frames from either source down to the defined buttons', () => {
    const session = new LocalSession(() => 0xff);
    session.submitLocalInput(0, 0xff);
    expect(session.inputsForTick(0)).toEqual([0x7f, 0x7f]);
  });
});
