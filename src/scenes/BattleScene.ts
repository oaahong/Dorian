import * as Phaser from 'phaser';
import { BattleView } from '../render/BattleView';
import { KeyboardSampler } from '../render/KeyboardSampler';
import { CpuBrain } from '../sim/cpu';
import { ENDING_TICKS, TICK_MS } from '../sim/constants';
import { EMPTY_INPUT, type InputFrame } from '../sim/input';
import { createRng } from '../sim/rng';
import { createWorld, stepWorld } from '../sim/world';
import type { SimEvent, SimWorld } from '../sim/types';
import { AudioManager } from '../systems/AudioManager';
import { gameState } from '../systems/GameState';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';

/**
 * Owns the simulation and drives it on a fixed timestep.
 *
 * The scene no longer contains any gameplay logic — it samples input, advances
 * `stepWorld` a whole number of ticks, and hands the resulting state and events
 * to the view. That separation is what makes lockstep possible: replacing the
 * local input source with one fed from the network is the only change needed.
 */

/**
 * Cap on how much time a single frame may contribute. Without it, returning to a
 * backgrounded tab would try to catch up thousands of ticks in one frame and
 * lock the page up.
 */
const MAX_CATCHUP_MS = 250;

export class BattleScene extends Phaser.Scene {
  private world!: SimWorld;
  private view!: BattleView;
  private p1Input!: KeyboardSampler;
  private p2Input: KeyboardSampler | null = null;
  private cpu: CpuBrain | null = null;

  private accumulator = 0;
  private pendingEvents: SimEvent[] = [];
  private paused = false;
  private pausePanel!: Phaser.GameObjects.Container;
  private leaving = false;

  private debugEnabled = false;
  private debugText!: Phaser.GameObjects.Text;

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.accumulator = 0;
    this.pendingEvents = [];
    this.paused = false;
    this.leaving = false;
    this.debugEnabled = false;

    const versusCpu = gameState.data.mode === 'cpu';
    this.world = createWorld({
      seed: gameState.data.seed,
      p1Character: gameState.data.p1Character,
      p2Character: gameState.data.p2Character,
      stage: gameState.data.stage,
    });

    this.view = new BattleView(this, this.world, versusCpu ? 'CPU' : 'P2');
    this.p1Input = new KeyboardSampler(this, 1);
    if (versusCpu) {
      // Seeded from the match seed so a 1P match is reproducible too.
      this.cpu = new CpuBrain(1, gameState.data.difficulty, createRng(gameState.data.seed ^ 0x5f5f));
    } else {
      this.p2Input = new KeyboardSampler(this, 2);
    }

    this.debugText = this.add
      .text(16, 116, '', {
        fontFamily: 'monospace', fontSize: '14px', color: '#7CFF00',
        backgroundColor: '#000000aa', padding: { x: 6, y: 5 },
      })
      .setDepth(1401)
      .setVisible(false);

    this.createPausePanel();
    this.bindGlobalKeys();
  }

  update(_time: number, delta: number): void {
    if (this.paused || this.leaving) return;

    this.accumulator += Math.min(delta, MAX_CATCHUP_MS);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      const inputs = this.sampleInputs();
      const events = stepWorld(this.world, inputs);
      for (const event of events) this.pendingEvents.push(event);
    }

    this.view.render(this.world, this.pendingEvents);
    this.pendingEvents.length = 0;
    this.drawDebug();
    this.checkMatchOver();
  }

  private sampleInputs(): [InputFrame, InputFrame] {
    const p1 = this.p1Input.sample();
    if (this.cpu) return [p1, this.cpu.decide(this.world)];
    return [p1, this.p2Input?.sample() ?? EMPTY_INPUT];
  }

  /**
   * The simulation reports the winner as soon as the deciding round ends, then
   * keeps stepping through the wind-down so the K.O. animation plays out.
   */
  private checkMatchOver(): void {
    if (this.leaving || this.world.matchWinner === null) return;
    if (this.world.phase !== 'ending' || this.world.phaseTicks + 1 < ENDING_TICKS) return;

    this.leaving = true;
    gameState.data.p1RoundWins = this.world.roundWins[0];
    gameState.data.p2RoundWins = this.world.roundWins[1];
    gameState.data.matchWinner = this.world.matchWinner === 0 ? 1 : 2;
    this.scene.start('ResultScene');
  }

  private createPausePanel(): void {
    const shade = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, .78);
    const title = this.add.text(GAME_WIDTH / 2, 300, 'PAUSED', { fontFamily: FONT_FAMILY, fontSize: '68px', color: '#E9B928', stroke: '#050505', strokeThickness: 9 }).setOrigin(.5);
    const help = this.add.text(GAME_WIDTH / 2, 390, 'ESC  RESUME\nQ  MAIN MENU', { fontFamily: FONT_FAMILY, fontSize: '24px', color: '#F3E9D0', align: 'center', lineSpacing: 12 }).setOrigin(.5);
    this.pausePanel = this.add.container(0, 0, [shade, title, help]).setDepth(2000).setVisible(false);
  }

  private bindGlobalKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    const handler = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'Escape':
          this.paused = !this.paused;
          this.pausePanel.setVisible(this.paused);
          // Drop the accumulator and any latched keys so resuming does not
          // replay the pause keypress or fast-forward through the pause.
          this.accumulator = 0;
          this.p1Input.reset();
          this.p2Input?.reset();
          AudioManager.play('menu');
          break;
        case 'KeyQ':
          if (!this.paused) break;
          this.leaving = true;
          gameState.resetMatch();
          this.scene.start('ModeSelectScene');
          break;
        case 'F2':
          event.preventDefault();
          this.debugEnabled = !this.debugEnabled;
          this.debugText.setVisible(this.debugEnabled);
          break;
        case 'KeyM': {
          const muted = AudioManager.toggleMute();
          this.add.text(GAME_WIDTH / 2, 120, muted ? 'MUTED' : 'SOUND ON', { fontFamily: FONT_FAMILY, fontSize: '20px', color: '#F3E9D0' })
            .setOrigin(.5).setDepth(1300)
            .setAlpha(1);
          break;
        }
        default:
          break;
      }
    };

    keyboard.on('keydown', handler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.off('keydown', handler);
      this.view.destroy();
    });
  }

  private drawDebug(): void {
    if (!this.debugEnabled) return;
    const [p1, p2] = this.world.fighters;
    this.debugText.setText([
      `FPS ${this.game.loop.actualFps.toFixed(1)}  TICK ${this.world.tick}  PHASE ${this.world.phase}  STAGE ${this.world.stage}`,
      `HITSTOP ${this.world.hitStopTicks}  PROJ ${this.world.projectiles.length}  ZONES ${this.world.zones.length}`,
      `P1 ${p1.state} HP=${p1.hp.toFixed(1)} E=${p1.energy.toFixed(0)} CD=${Math.max(0, p1.nextSpecialTick - this.world.tick).toFixed(0)}t`,
      `P2 ${p2.state} HP=${p2.hp.toFixed(1)} E=${p2.energy.toFixed(0)} CD=${Math.max(0, p2.nextSpecialTick - this.world.tick).toFixed(0)}t`,
    ]);
  }
}
