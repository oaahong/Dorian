import * as Phaser from 'phaser';
import { BattleView } from '../render/BattleView';
import { KeyboardSampler } from '../render/KeyboardSampler';
import { LocalSession } from '../net/LocalSession';
import { endOnlineMatch, onlineMatch } from '../net/onlineMatch';
import type { Session } from '../net/Session';
import { CpuBrain } from '../sim/cpu';
import { ENDING_TICKS, TICK_HZ, TICK_MS } from '../sim/constants';
import { EMPTY_INPUT } from '../sim/input';
import { createRng } from '../sim/rng';
import { checksum, createWorld, stepWorld } from '../sim/world';
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

/**
 * How much backlog may survive a stall, in ticks.
 *
 * A stall is not a debt to repay. Both clients are gated on the same inputs, so
 * neither is ever "ahead" — the simulation simply cannot run faster than the
 * opponent supplies frames, and carrying the waiting time forward leaves the game
 * permanently behind real time. Left unbounded it reached several seconds within
 * one exchange, at which point every keypress lands seconds late and the match
 * feels disconnected.
 *
 * A few ticks are kept rather than none, so a client on a 30 Hz display can still
 * run two ticks per frame and hold 60 Hz.
 */
const MAX_STALL_BACKLOG_TICKS = 4;

/** Ticks of waiting before the player is told the game is waiting. */
const STALL_NOTICE_TICKS = 30;
/** Ticks of waiting before the match is abandoned. */
const STALL_GIVE_UP_TICKS = 15 * TICK_HZ;

export class BattleScene extends Phaser.Scene {
  private world!: SimWorld;
  private view!: BattleView;
  private p1Input!: KeyboardSampler;
  private p2Input: KeyboardSampler | null = null;
  private cpu: CpuBrain | null = null;
  private session!: Session;

  private accumulator = 0;
  /** The tick whose input has already been sampled and submitted. */
  private lastSampledTick = -1;
  private pendingEvents: SimEvent[] = [];
  private paused = false;
  private pausePanel!: Phaser.GameObjects.Container;
  private leaving = false;

  private online = false;
  private statusText!: Phaser.GameObjects.Text;

  private debugEnabled = false;
  private debugText!: Phaser.GameObjects.Text;

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.accumulator = 0;
    this.lastSampledTick = -1;
    this.pendingEvents = [];
    this.paused = false;
    this.leaving = false;
    this.debugEnabled = false;

    const versusCpu = gameState.data.mode === 'cpu';
    this.online = gameState.data.mode === 'online' && onlineMatch.current !== null;
    this.world = createWorld({
      seed: gameState.data.seed,
      p1Character: gameState.data.p1Character,
      p2Character: gameState.data.p2Character,
      stage: gameState.data.stage,
    });

    this.view = new BattleView(this, this.world, versusCpu ? 'CPU' : this.online ? 'RIVAL' : 'P2');
    // Online, each player uses the P1 controls on their own keyboard; which
    // fighter those drive is decided by the seat the server handed out.
    this.p1Input = new KeyboardSampler(this, 1);
    if (versusCpu) {
      // Seeded from the match seed so a 1P match is reproducible too.
      this.cpu = new CpuBrain(1, gameState.data.difficulty, createRng(gameState.data.seed ^ 0x5f5f));
    } else {
      this.p2Input = new KeyboardSampler(this, 2);
    }

    // The one seam between local and online play.
    this.session = this.online
      ? onlineMatch.current!.session
      : new LocalSession(() =>
          this.cpu ? this.cpu.decide(this.world) : this.p2Input?.sample() ?? EMPTY_INPUT,
        );

    this.statusText = this.add
      .text(GAME_WIDTH / 2, 300, '', {
        fontFamily: FONT_FAMILY, fontSize: '34px', color: '#F3E9D0',
        backgroundColor: '#050505cc', padding: { x: 20, y: 12 }, align: 'center',
      })
      .setOrigin(.5)
      .setDepth(1500)
      .setVisible(false);

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

    // Bounded on both sides: a single long frame cannot contribute more than
    // MAX_CATCHUP_MS, and the running total cannot exceed it either.
    this.accumulator = Math.min(this.accumulator + Math.min(delta, MAX_CATCHUP_MS), MAX_CATCHUP_MS);

    while (this.accumulator >= TICK_MS) {
      const tick = this.world.tick;

      /**
       * Sampled exactly once per tick. Re-sampling while stalled would both
       * discard the keys latched since the last read and offer the session a
       * different answer for a tick it has already transmitted — which the
       * opponent ignores, leaving the two simulations running that tick from
       * different inputs.
       */
      if (tick !== this.lastSampledTick) {
        this.lastSampledTick = tick;
        this.session.submitLocalInput(tick, this.p1Input.sample());
      } else {
        this.session.resend?.();
      }

      // Online this returns null while the opponent's frame is in flight; the
      // simulation must hold rather than guess. Locally it never does.
      const inputs = this.session.inputsForTick(tick);
      if (!inputs) {
        this.accumulator = Math.min(this.accumulator, TICK_MS * MAX_STALL_BACKLOG_TICKS);
        break;
      }

      this.accumulator -= TICK_MS;
      const events = stepWorld(this.world, inputs);
      for (const event of events) this.pendingEvents.push(event);

      // Exchanged once a second. Cheap, and the only way a divergence gets
      // reported before the two screens visibly disagree.
      if (this.online && this.world.tick % TICK_HZ === 0) {
        onlineMatch.current!.session.recordChecksum(this.world.tick, checksum(this.world));
      }
    }

    this.view.render(this.world, this.pendingEvents);
    this.pendingEvents.length = 0;
    this.drawDebug();
    this.updateConnectionStatus();
    this.checkMatchOver();
  }

  /**
   * Surface what the session is doing, since online the simulation can legitimately
   * stop for reasons the player cannot see.
   */
  private updateConnectionStatus(): void {
    if (!this.online) return;
    const session = onlineMatch.current!.session;

    let text = '';
    if (session.status === 'desync') {
      text = 'DESYNC\nTHE TWO GAMES DISAGREED';
    } else if (session.status === 'disconnected') {
      text = 'DISCONNECTED';
    } else if (session.stalledTicks > STALL_NOTICE_TICKS) {
      text = 'WAITING FOR OPPONENT...';
    }

    this.statusText.setVisible(text !== '').setText(text);

    // Give up rather than hanging on a connection that is not coming back.
    if (session.stalledTicks > STALL_GIVE_UP_TICKS || session.status === 'desync') {
      this.leaveOnline();
    }
  }

  private leaveOnline(): void {
    if (this.leaving) return;
    this.leaving = true;
    endOnlineMatch();
    gameState.resetMatch();
    this.scene.start('ModeSelectScene');
  }

  /**
   * The simulation reports the winner as soon as the deciding round ends, then
   * keeps stepping through the wind-down so the K.O. animation plays out.
   */
  private checkMatchOver(): void {
    if (this.leaving || this.world.matchWinner === null) return;
    if (this.world.phase !== 'ending' || this.world.phaseTicks + 1 < ENDING_TICKS) return;

    this.leaving = true;
    if (this.online) endOnlineMatch();
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
          // Pausing online would stall the opponent indefinitely, so it leaves
          // the match instead.
          if (this.online) { this.leaveOnline(); break; }
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
