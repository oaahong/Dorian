import * as Phaser from 'phaser';
import { getFighterConfig } from '../fighters/fighterData';
import type { SimEvent, SimWorld } from '../sim/types';
import { AudioManager } from '../systems/AudioManager';
import { VFXManager } from '../systems/VFXManager';
import { StageRenderer } from '../stages/StageRenderer';
import { BattleHUD } from '../ui/BattleHUD';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';
import { ultimateDefinitionFor } from '../fighters/ultimateDefinitions';
import { CombatView } from './CombatView';
import { FighterView } from './FighterView';
import { UltimateCutIn } from './UltimateCutIn';

/**
 * Everything the player sees, driven entirely by `SimWorld` plus the event stream
 * from `stepWorld`.
 *
 * This layer never writes to the simulation. That is the whole point of the
 * split: sound, particles and screen shake can stay as random and as
 * frame-rate-dependent as they like without ever affecting what the other client
 * computes.
 */
export class BattleView {
  private readonly world: Phaser.GameObjects.Container;
  private readonly vfx: VFXManager;
  private readonly combat: CombatView;
  private readonly fighters: [FighterView, FighterView];
  private readonly hud: BattleHUD;
  private readonly cutIn: UltimateCutIn;
  /** The last ultimate phase named on screen, so a flurry says its name once. */
  private lastPhaseLabel = '';

  constructor(private readonly scene: Phaser.Scene, sim: SimWorld, modeLabel: string) {
    scene.cameras.main.setBackgroundColor(COLORS.bg);
    this.world = scene.add.container(0, 0);
    StageRenderer.render(scene, this.world, sim.stage as never);

    this.fighters = [new FighterView(scene, sim.fighters[0]), new FighterView(scene, sim.fighters[1])];
    this.world.add([this.fighters[0].sprite, this.fighters[1].sprite]);

    this.vfx = new VFXManager(scene, this.world);
    this.combat = new CombatView(scene, this.world, this.vfx);
    this.hud = new BattleHUD(scene, sim, modeLabel);
    this.cutIn = new UltimateCutIn(scene);
    // A round can end, or the scene can be left, in the middle of a cut-in.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cutIn.stop());
  }

  /** Draw one frame. `events` is everything the simulation emitted since the last call. */
  render(sim: SimWorld, events: readonly SimEvent[]): void {
    for (const event of events) this.handle(sim, event);

    // Driven by the simulation's own freeze countdown, not by elapsed time — see
    // UltimateCutIn for why that distinction matters.
    if (this.cutIn.isActive) this.cutIn.sync(sim.hitStopTicks);

    const now = this.scene.time.now;
    this.fighters[0].sync(sim.fighters[0], now);
    this.fighters[1].sync(sim.fighters[1], now);
    this.combat.sync(sim);
    this.hud.update(sim);
  }

  destroy(): void {
    this.combat.destroy();
    this.vfx.destroy();
  }

  private handle(sim: SimWorld, event: SimEvent): void {
    this.combat.handle(event);

    switch (event.t) {
      case 'roundStart':
        this.lastPhaseLabel = '';
        this.fighters[0].reset();
        this.fighters[1].reset();
        this.combat.clear();
        this.announce(`ROUND ${event.round}`, COLORS.cream, 58, 520);
        break;

      case 'announce':
        this.announce(event.text, COLORS.red, 72, 440);
        AudioManager.play('heavy');
        this.vfx.flash(COLORS.white, 0.2, 70);
        break;

      case 'jump':
        AudioManager.play('jump');
        break;

      case 'attackStart':
        this.onAttackStart(sim, event);
        break;

      case 'ultimateStart':
        this.presentUltimate(sim, event.player, event.specId);
        break;

      case 'ultimatePhase':
        this.presentUltimatePhase(sim, event);
        break;

      case 'ultimateEnd':
        // So the next ultimate can announce a beat this one already named.
        this.lastPhaseLabel = '';
        break;

      case 'hit':
        this.onHit(sim, event);
        break;

      case 'roundEnd':
        this.onRoundEnd(sim, event);
        break;

      default:
        break;
    }
  }

  private onAttackStart(sim: SimWorld, event: Extract<SimEvent, { t: 'attackStart' }>): void {
    const spec = getFighterConfig(sim.fighters[event.player].configId);
    if (event.specId === spec.ultimate.id) return; // ultimateStart handles the fanfare
    if (event.specId === spec.specials.quarterForward.id) AudioManager.play('special');
  }

  private onHit(sim: SimWorld, event: Extract<SimEvent, { t: 'hit' }>): void {
    const attacker = sim.fighters[event.player];
    const defenderView = this.fighters[event.player === 0 ? 1 : 0];
    const palette = getFighterConfig(attacker.configId).palette;

    if (event.blocked) {
      this.vfx.blockSpark(event.x, event.y);
      AudioManager.play('block');
      return;
    }

    const heavy = event.impact !== 'light';
    const color =
      event.impact === 'ultimate' ? palette.accent
      : event.impact === 'special' ? palette.secondary
      : COLORS.gold;

    this.vfx.hitSpark(event.x, event.y, heavy, color);
    this.vfx.memePopup(event.x, event.y);
    defenderView.flashHit();

    if (event.impact === 'light') {
      AudioManager.play('light');
    } else if (event.impact === 'heavy') {
      AudioManager.play('heavy');
      this.vfx.shake(0.005, 100);
    } else if (event.impact === 'special') {
      AudioManager.play('special');
      this.vfx.shake(0.007, 130);
    } else {
      AudioManager.play('ultimate');
      this.vfx.flash(COLORS.white, 0.46, 90);
      this.vfx.shake(0.012, 220);
    }
  }

  private presentUltimate(sim: SimWorld, player: 0 | 1, _specId: string): void {
    const fighter = sim.fighters[player];
    const definition = ultimateDefinitionFor(fighter.configId);

    // The simulation has already frozen itself for `cutInTicks`; the cut-in reads
    // that countdown each frame rather than starting a clock of its own.
    this.cutIn.start(definition, player);

    this.vfx.pixelBlocks(getFighterConfig(fighter.configId).palette.primary, 30);
    this.fighters[player].punchScale(1.45, 680);
    AudioManager.play('ultimate');
  }

  /**
   * One beat of an ultimate's timeline.
   *
   * The simulation says *that* a phase landed and what it was called; everything
   * here is the staging. Naming the beat matters more than it looks — a four-part
   * ultimate reads as one long flash otherwise, and the labels are how a player
   * learns that the third part is the one aimed where they used to be standing.
   */
  private presentUltimatePhase(
    sim: SimWorld,
    event: Extract<SimEvent, { t: 'ultimatePhase' }>,
  ): void {
    const owner = sim.fighters[event.player];
    const palette = getFighterConfig(owner.configId).palette;
    this.vfx.flash(palette.accent, 0.22, 90);
    this.vfx.shake(0.009, 140);
    this.phaseCallout(event.label, palette.primary);
  }

  /**
   * Name the beat, high on the screen and only when the name changes.
   *
   * Not `announce`, which owns the centre of the screen for ROUND and K.O. — a
   * grab's ten-hit flurry would stack ten copies of the same word over the
   * fighters, which is worse than saying nothing. Repeats are dropped for the
   * same reason: the flurry is one idea, not ten.
   */
  private phaseCallout(text: string, color: number): void {
    if (text === this.lastPhaseLabel) return;
    this.lastPhaseLabel = text;

    const label = this.scene.add
      .text(GAME_WIDTH / 2, 190, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '30px',
        color: `#${color.toString(16).padStart(6, '0')}`,
        stroke: '#050505',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(1290)
      .setAlpha(0);

    this.scene.tweens.add({
      targets: label,
      alpha: { from: 0, to: 1 },
      y: 160,
      duration: 140,
      yoyo: true,
      hold: 260,
      onComplete: () => label.destroy(),
    });
  }

  private onRoundEnd(sim: SimWorld, event: Extract<SimEvent, { t: 'roundEnd' }>): void {
    if (event.reason === 'KO') {
      AudioManager.play('ko');
      const loser = sim.fighters[event.winner === 1 ? 1 : 0];
      this.vfx.hitSpark(loser.x, loser.y - 115, true, COLORS.red);
      this.vfx.flash(COLORS.white, 0.72, 110);
      this.vfx.shake(0.018, 380);
      this.announce('K.O.', COLORS.red, 110, 900);
      return;
    }
    this.announce(
      event.winner === 0 ? 'DRAW' : 'TIME!',
      event.winner === 0 ? COLORS.cream : COLORS.gold,
      76,
      850,
    );
  }

  private announce(text: string, color: number, size: number, duration: number): void {
    const label = this.scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, text, {
        fontFamily: FONT_FAMILY,
        fontSize: `${size}px`,
        color: `#${color.toString(16).padStart(6, '0')}`,
        stroke: '#050505',
        strokeThickness: 12,
      })
      .setOrigin(0.5)
      .setDepth(1300)
      .setScale(0.4)
      .setAlpha(0);

    this.scene.tweens.add({
      targets: label,
      alpha: 1,
      scale: 1,
      duration: 110,
      ease: 'Back.easeOut',
      hold: Math.max(80, duration - 220),
      yoyo: true,
      onComplete: () => label.destroy(),
    });
  }
}
