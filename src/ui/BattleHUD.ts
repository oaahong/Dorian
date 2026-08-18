import * as Phaser from 'phaser';
import { getFighterConfig } from '../fighters/fighterData';
import { TICK_HZ } from '../sim/constants';
import type { SimWorld } from '../sim/types';
import { COLORS, FONT_FAMILY, GAME_WIDTH } from '../utils/constants';
import { HealthBar } from './HealthBar';
import { MemeMeter } from './MemeMeter';

const COMBO_STYLE = {
  fontFamily: FONT_FAMILY,
  fontSize: '30px',
  color: '#ffd45c',
  stroke: '#050505',
  strokeThickness: 7,
} as const;

/**
 * Reads straight from SimWorld each frame. Timers are shown in seconds derived
 * from tick counts rather than from the wall clock, so the number on screen
 * always agrees with what the simulation thinks.
 */
export class BattleHUD {
  private readonly p1Health: HealthBar;
  private readonly p2Health: HealthBar;
  private readonly p1Meme: MemeMeter;
  private readonly p2Meme: MemeMeter;
  private readonly timer: Phaser.GameObjects.Text;
  private readonly roundTextP1: Phaser.GameObjects.Text;
  private readonly roundTextP2: Phaser.GameObjects.Text;
  private readonly help: Phaser.GameObjects.Text;
  private readonly p1Special: Phaser.GameObjects.Text;
  private readonly p2Special: Phaser.GameObjects.Text;
  private readonly specialNames: [string, string];
  private readonly comboText: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];

  constructor(scene: Phaser.Scene, world: SimWorld, modeLabel: string) {
    const p1Config = getFighterConfig(world.fighters[0].configId);
    const p2Config = getFighterConfig(world.fighters[1].configId);
    this.specialNames = [
      p1Config.specials.quarterForward.name,
      p2Config.specials.quarterForward.name,
    ];

    scene.add.rectangle(GAME_WIDTH / 2, 52, GAME_WIDTH - 36, 88, 0x050505, .82).setStrokeStyle(2, COLORS.gold, .7).setDepth(995);
    scene.add.text(45, 18, `P1  ${p1Config.name}`, { fontFamily:FONT_FAMILY, fontSize:'21px', color:'#E9B928' }).setDepth(1002);
    scene.add.text(GAME_WIDTH - 45, 18, `${modeLabel}  ${p2Config.name}`, { fontFamily:FONT_FAMILY, fontSize:'21px', color:'#00C8FF' }).setOrigin(1,0).setDepth(1002);
    this.p1Health = new HealthBar(scene, 45, 58, 455, false);
    this.p2Health = new HealthBar(scene, GAME_WIDTH - 45, 58, 455, true);
    this.p1Meme = new MemeMeter(scene, 45, 690, 360, false);
    this.p2Meme = new MemeMeter(scene, GAME_WIDTH - 45, 690, 360, true);
    this.timer = scene.add.text(GAME_WIDTH / 2, 47, '60', { fontFamily:FONT_FAMILY, fontSize:'38px', color:'#F3E9D0', stroke:'#050505', strokeThickness:6 }).setOrigin(.5).setDepth(1004);
    this.roundTextP1 = scene.add.text(45, 83, '☆ ☆', { fontFamily:FONT_FAMILY, fontSize:'19px', color:'#E9B928' }).setDepth(1002);
    this.roundTextP2 = scene.add.text(GAME_WIDTH - 45, 83, '☆ ☆', { fontFamily:FONT_FAMILY, fontSize:'19px', color:'#00C8FF' }).setOrigin(1,0).setDepth(1002);
    this.p1Special = scene.add.text(45, 655, '', { fontFamily:FONT_FAMILY, fontSize:'13px', color:'#E9B928' }).setDepth(1004);
    this.p2Special = scene.add.text(GAME_WIDTH - 45, 655, '', { fontFamily:FONT_FAMILY, fontSize:'13px', color:'#00C8FF' }).setOrigin(1,0).setDepth(1004);
    /**
     * Two lines, because the second one is the only place the universal
     * mechanics are written down anywhere in the game. A button pair is not a
     * thing a player discovers by mashing — they will find the single buttons
     * and stop, and the whole combo layer stays invisible.
     */
    const keys = 'P1: WASD / F G H / R THROW / T ULT    •    P2: ARROWS / J K L / U I    •    ESC PAUSE    •    M MUTE';
    const combos = 'LIGHT+HEAVY RUSH (cancels)    •    LIGHT+SP PARRY    •    HEAVY+SP IMPACT    •    TAP ↔ TWICE TO DASH';
    this.comboText = [
      scene.add.text(150, 150, '', COMBO_STYLE).setOrigin(0, 0.5).setDepth(1006).setVisible(false),
      scene.add.text(GAME_WIDTH - 150, 150, '', COMBO_STYLE).setOrigin(1, 0.5).setDepth(1006).setVisible(false),
    ];

    this.help = scene.add.text(GAME_WIDTH / 2, 635, `${keys}\n${combos}`, { fontFamily:FONT_FAMILY, fontSize:'14px', color:'#d8d0bf', backgroundColor:'#050505aa', align:'center', padding:{x:10,y:5} }).setOrigin(.5).setDepth(1005);
    scene.tweens.add({ targets:this.help, alpha:.28, delay:4500, duration:900 });
  }

  update(world: SimWorld): void {
    const [p1, p2] = world.fighters;
    this.p1Health.update(p1.hp);
    this.p2Health.update(p2.hp);
    this.p1Meme.update(p1.energy);
    this.p2Meme.update(p2.energy);
    this.timer.setText(`${Math.max(0, Math.ceil(world.roundTicksRemaining / TICK_HZ))}`);
    this.roundTextP1.setText(`${world.roundWins[0] >= 1 ? '★' : '☆'} ${world.roundWins[0] >= 2 ? '★' : '☆'}`);
    this.roundTextP2.setText(`${world.roundWins[1] >= 1 ? '★' : '☆'} ${world.roundWins[1] >= 2 ? '★' : '☆'}`);
    this.p1Special.setText(`${this.specialNames[0]}: ${cooldownLabel(p1.nextSpecialTick, world.tick)}`);
    this.p2Special.setText(`${this.specialNames[1]}: ${cooldownLabel(p2.nextSpecialTick, world.tick)}`);
    this.updateCombo(0, p1);
    this.updateCombo(1, p2);
  }

  /**
   * The hit count, shown on the attacker's side of the screen.
   *
   * Combo damage scales down, and scaling that nobody can see is just a number
   * quietly disagreeing with the player. The count is what makes "this one is
   * worth less" legible while it is happening — which is also the information you
   * need to decide whether to keep going or reset.
   *
   * Two hits, not one: every clean hit is a one-hit combo, and labelling those
   * would put a counter on the screen for the entire match.
   */
  private updateCombo(seat: 0 | 1, fighter: SimWorld['fighters'][0]): void {
    const label = this.comboText[seat]!;
    if (fighter.comboHits < 2) {
      label.setVisible(false);
      return;
    }
    label.setVisible(true).setText(`${fighter.comboHits} HITS`);
  }
}

function cooldownLabel(readyAtTick: number, tick: number): string {
  const remaining = Math.max(0, readyAtTick - tick);
  return remaining <= 0 ? 'READY' : `${(remaining / TICK_HZ).toFixed(1)}s`;
}
