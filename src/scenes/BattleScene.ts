import * as Phaser from 'phaser';
import { BattleView } from '../render/BattleView';
import { KeyboardSampler } from '../render/KeyboardSampler';
import { LocalSession } from '../net/LocalSession';
import { endOnlineMatch, onlineMatch } from '../net/onlineMatch';
import type { Session } from '../net/Session';
import { CpuBrain } from '../sim/cpu';
import { BLOCK_STANCE_RANGE, ENDING_TICKS, TICK_HZ, TICK_MS } from '../sim/constants';
import { BUTTON, EMPTY_INPUT, type InputFrame } from '../sim/input';
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
  /**
   * Training only. The simulation holds still until stepped or unfrozen.
   *
   * Separate from `paused` because they mean different things: a pause hides the
   * match behind a panel and stops sampling, while a freeze leaves everything on
   * screen and live so that a single frame can be inspected and advanced.
   */
  private frozen = false;
  /** Training only. The idle second seat holds guard, so blockstun can be read. */
  private dummyGuards = false;
  private trainingText: Phaser.GameObjects.Text | null = null;
  private pausePanel!: Phaser.GameObjects.Container;
  private leaving = false;

  private online = false;
  private statusText!: Phaser.GameObjects.Text;

  private debugEnabled = false;
  private debugText!: Phaser.GameObjects.Text;
  private ticksPerSecond = 0;
  private rateSampledAtMs = 0;
  private rateSampledTick = 0;

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.accumulator = 0;
    this.lastSampledTick = -1;
    this.pendingEvents = [];
    this.paused = false;
    this.frozen = false;
    this.dummyGuards = false;
    this.trainingText = null;
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

    const secondSeat = versusCpu ? 'CPU' : this.online ? 'RIVAL' : gameState.isTraining ? 'DUMMY' : 'P2';
    this.view = new BattleView(this, this.world, secondSeat);
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
      : new LocalSession(() => this.secondSeatInput());

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
    if (gameState.isTraining) this.createTrainingBanner();
    this.bindGlobalKeys();
  }

  update(_time: number, delta: number): void {
    if (this.paused || this.leaving) return;
    // A frozen match still renders — that is the point of it — so the draw below
    // runs while the fixed-step loop is skipped entirely.
    if (this.frozen) {
      this.drawFrame();
      return;
    }

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

    this.drawFrame();
  }

  /**
   * Draw the world as it currently stands.
   *
   * Split out of `update` so a frozen training match can keep rendering — and so a
   * single stepped tick shows up immediately rather than on the next frame.
   */
  private drawFrame(): void {
    this.view.render(this.world, this.pendingEvents);
    this.pendingEvents.length = 0;
    this.drawDebug();
    this.updateConnectionStatus();
    this.checkMatchOver();
  }

  /**
   * Put the round back to its opening state, for F5.
   *
   * Rebuilds the world rather than mutating it: the match state that matters is
   * spread across fighters, projectiles, zones and phase timers, and resetting each
   * by hand is how one gets forgotten.
   */
  private resetTrainingRound(): void {
    this.world = createWorld({
      seed: gameState.data.seed,
      p1Character: gameState.data.p1Character,
      p2Character: gameState.data.p2Character,
      stage: gameState.data.stage,
    });
    this.accumulator = 0;
    this.lastSampledTick = -1;
    this.pendingEvents.length = 0;
    this.p1Input.reset();
    this.p2Input?.reset();
    // Training is never online, so a fresh local session is both safe and the
    // clearest way to drop the tick it had cached from before the reset.
    this.session = new LocalSession(() => this.secondSeatInput());
    this.drawFrame();
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

    /**
     * Training never ends. Being thrown to the results screen because the round
     * clock ran out is the opposite of what a practice mode is for, so a finished
     * match simply starts over.
     */
    if (gameState.isTraining) {
      this.resetTrainingRound();
      return;
    }

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

  /**
   * The training keys, on screen because a debug binding nobody can discover is a
   * feature that does not exist.
   */
  private createTrainingBanner(): void {
    this.trainingText = this.add
      .text(GAME_WIDTH / 2, 96, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        color: '#9ed7ff',
        backgroundColor: '#050505cc',
        padding: { x: 10, y: 5 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(1006);
    this.refreshTrainingBanner();
  }

  private refreshTrainingBanner(): void {
    this.trainingText?.setText(
      `TRAINING  •  F3 ${this.frozen ? 'RESUME' : 'FREEZE'}  •  F4 STEP  •  F5 RESET  •  F6 DUMMY GUARD ${this.dummyGuards ? 'ON' : 'OFF'}`,
    );
  }

  /**
   * What the second seat is holding.
   *
   * In training there is nobody there, so it either does nothing or holds guard —
   * which is the only way to read a move's blockstun without a second player.
   */
  private secondSeatInput(): InputFrame {
    if (this.cpu) return this.cpu.decide(this.world);
    if (gameState.isTraining) {
      if (!this.dummyGuards) return EMPTY_INPUT;
      /**
       * Hold away from P1, which is what the simulation infers a guard from — but
       * only once P1 is close enough for that to *be* a guard.
       *
       * Outside `BLOCK_STANCE_RANGE`, holding away is just walking, and a dummy
       * that walks away every time you switch guard on retreats into the corner and
       * stops being a practice target. Inside it, the block stance pins it in place.
       */
      const [p1, p2] = this.world.fighters;
      if (Math.abs(p1.x - p2.x) >= BLOCK_STANCE_RANGE) return EMPTY_INPUT;
      return p1.x > p2.x ? BUTTON.Left : BUTTON.Right;
    }
    return this.p2Input?.sample() ?? EMPTY_INPUT;
  }

  /** Advance exactly one tick, for F4. */
  private stepOneTick(): void {
    const tick = this.world.tick;
    this.session.submitLocalInput(tick, this.p1Input.sample());
    this.lastSampledTick = tick;
    const inputs = this.session.inputsForTick(tick);
    if (!inputs) return;
    for (const event of stepWorld(this.world, inputs)) this.pendingEvents.push(event);
    this.drawFrame();
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

        /**
         * Training controls. Deliberately unavailable in every other mode — a
         * freeze or a reset is a desync online, and an unearned advantage locally.
         */
        case 'F3':
          if (!gameState.isTraining) break;
          event.preventDefault();
          this.frozen = !this.frozen;
          // Drop the backlog so unfreezing resumes rather than fast-forwarding
          // through everything the freeze skipped.
          this.accumulator = 0;
          this.p1Input.reset();
          this.refreshTrainingBanner();
          break;
        case 'F4':
          if (!gameState.isTraining || !this.frozen) break;
          event.preventDefault();
          this.stepOneTick();
          break;
        case 'F5':
          if (!gameState.isTraining) break;
          event.preventDefault();
          this.resetTrainingRound();
          break;
        case 'F6':
          if (!gameState.isTraining) break;
          event.preventDefault();
          this.dummyGuards = !this.dummyGuards;
          this.refreshTrainingBanner();
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

    // Ticks per second is the number that matters online: the frame rate can be
    // low and the match still perfect, but a simulation running below sixty ticks
    // a second is one being held up by the connection.
    const now = this.time.now;
    if (now - this.rateSampledAtMs >= 1000) {
      this.ticksPerSecond = ((this.world.tick - this.rateSampledTick) * 1000) / (now - this.rateSampledAtMs);
      this.rateSampledAtMs = now;
      this.rateSampledTick = this.world.tick;
    }

    const session = this.online ? onlineMatch.current?.session : null;
    const net = session
      ? `NET ${session.status} delay=${session.inputDelay} stalled=${session.stalledTicks}` +
        `${session.desyncTick === null ? '' : ` DESYNC@${session.desyncTick}`}`
      : 'NET local';

    this.debugText.setText([
      net,
      `FPS ${this.game.loop.actualFps.toFixed(1)}  TPS ${this.ticksPerSecond.toFixed(1)}  TICK ${this.world.tick}  PHASE ${this.world.phase}`,
      `HITSTOP ${this.world.hitStopTicks}  PROJ ${this.world.projectiles.length}  ZONES ${this.world.zones.length}`,
      `P1 ${p1.state} HP=${p1.hp.toFixed(1)} E=${p1.energy.toFixed(0)} CD=${Math.max(0, p1.nextSpecialTick - this.world.tick).toFixed(0)}t`,
      `P2 ${p2.state} HP=${p2.hp.toFixed(1)} E=${p2.energy.toFixed(0)} CD=${Math.max(0, p2.nextSpecialTick - this.world.tick).toFixed(0)}t`,
    ]);
  }
}
