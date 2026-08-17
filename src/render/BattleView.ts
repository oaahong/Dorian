import * as Phaser from 'phaser';
import { getFighterConfig } from '../fighters/fighterData';
import type { SimEvent, SimWorld } from '../sim/types';
import { AudioManager } from '../systems/AudioManager';
import { VFXManager } from '../systems/VFXManager';
import { StageRenderer } from '../stages/StageRenderer';
import { BattleHUD } from '../ui/BattleHUD';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';
import { CombatView } from './CombatView';
import { FighterView } from './FighterView';

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

  constructor(private readonly scene: Phaser.Scene, sim: SimWorld, modeLabel: string) {
    scene.cameras.main.setBackgroundColor(COLORS.bg);
    this.world = scene.add.container(0, 0);
    StageRenderer.render(scene, this.world, sim.stage as never);

    this.fighters = [new FighterView(scene, sim.fighters[0]), new FighterView(scene, sim.fighters[1])];
    this.world.add([this.fighters[0].sprite, this.fighters[1].sprite]);

    this.vfx = new VFXManager(scene, this.world);
    this.combat = new CombatView(scene, this.world, this.vfx);
    this.hud = new BattleHUD(scene, sim, modeLabel);
  }

  /** Draw one frame. `events` is everything the simulation emitted since the last call. */
  render(sim: SimWorld, events: readonly SimEvent[]): void {
    for (const event of events) this.handle(sim, event);

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

  private presentUltimate(sim: SimWorld, player: 0 | 1, specId: string): void {
    const config = getFighterConfig(sim.fighters[player].configId);
    const color = config.palette.primary;
    const overlay = this.vfx.ultimateBackdrop(color, 1250);
    this.vfx.popup(config.ultimate.name || specId, GAME_WIDTH / 2, 155, COLORS.white, 48);
    this.vfx.flash(COLORS.white, 0.32, 85);
    this.vfx.shake(0.012, 360);
    this.vfx.pixelBlocks(color, 30);
    this.fighters[player].punchScale(1.45, 680);
    AudioManager.play('ultimate');
    this.scene.time.delayedCall(1250, () => overlay.destroy());
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
