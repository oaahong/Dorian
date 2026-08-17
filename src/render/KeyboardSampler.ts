import * as Phaser from 'phaser';
import { BUTTON, EMPTY_INPUT, INPUT_FRAME_MASK, type InputFrame } from '../sim/input';

const P1_KEYS = {
  [BUTTON.Left]: 'KeyA',
  [BUTTON.Right]: 'KeyD',
  [BUTTON.Up]: 'KeyW',
  [BUTTON.Down]: 'KeyS',
  [BUTTON.Light]: 'KeyF',
  [BUTTON.Heavy]: 'KeyG',
  [BUTTON.Special]: 'KeyH',
  [BUTTON.Throw]: 'KeyR',
  [BUTTON.Ultimate]: 'KeyT',
} as const;

const P2_KEYS = {
  [BUTTON.Left]: 'ArrowLeft',
  [BUTTON.Right]: 'ArrowRight',
  [BUTTON.Up]: 'ArrowUp',
  [BUTTON.Down]: 'ArrowDown',
  [BUTTON.Light]: 'KeyJ',
  [BUTTON.Heavy]: 'KeyK',
  [BUTTON.Special]: 'KeyL',
  [BUTTON.Throw]: 'KeyU',
  [BUTTON.Ultimate]: 'KeyI',
} as const;

/**
 * Turns the keyboard into one raw button frame per simulation tick.
 *
 * Sampling is decoupled from rendering: at 144 Hz a frame is shorter than a tick,
 * and at 30 Hz it is longer. Either way a tap that begins and ends between two
 * samples would be invisible to a pure level check, so every keydown latches a
 * bit that survives until the next sample. Without that, fast taps are silently
 * eaten on high-refresh displays.
 *
 * Physical `event.code` is used rather than `event.key` throughout, because a CJK
 * IME can report letter keys as composition input — see FIX_NOTES.md.
 */
export class KeyboardSampler {
  private readonly codeToButton = new Map<string, number>();
  private held = 0;
  /** Buttons pressed at any point since the last sample. */
  private latched = 0;

  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onKeyUp: (event: KeyboardEvent) => void;

  constructor(private readonly scene: Phaser.Scene, player: 1 | 2) {
    const map = player === 1 ? P1_KEYS : P2_KEYS;
    for (const [button, code] of Object.entries(map)) {
      this.codeToButton.set(code, Number(button));
    }

    this.onKeyDown = (event) => {
      const button = this.codeToButton.get(event.code);
      if (button === undefined) return;
      this.held |= button;
      this.latched |= button;
    };
    this.onKeyUp = (event) => {
      const button = this.codeToButton.get(event.code);
      if (button === undefined) return;
      this.held &= ~button;
    };

    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input unavailable');
    keyboard.on('keydown', this.onKeyDown);
    keyboard.on('keyup', this.onKeyUp);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Read and clear the latch. Call exactly once per simulation tick. */
  sample(): InputFrame {
    const frame = (this.held | this.latched) & INPUT_FRAME_MASK;
    this.latched = 0;
    return frame;
  }

  /** Forget everything held — used between rounds and when input is handed over. */
  reset(): void {
    this.held = EMPTY_INPUT;
    this.latched = EMPTY_INPUT;
  }

  destroy(): void {
    const keyboard = this.scene.input.keyboard;
    keyboard?.off('keydown', this.onKeyDown);
    keyboard?.off('keyup', this.onKeyUp);
  }
}
