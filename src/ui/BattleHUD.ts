import * as Phaser from 'phaser';
import type { Fighter } from '../fighters/Fighter';
import { COLORS, FONT_FAMILY, GAME_WIDTH } from '../utils/constants';
import { HealthBar } from './HealthBar';
import { MemeMeter } from './MemeMeter';

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

  constructor(scene: Phaser.Scene, p1: Fighter, p2: Fighter, modeLabel: string) {
    scene.add.rectangle(GAME_WIDTH / 2, 52, GAME_WIDTH - 36, 88, 0x050505, .82).setStrokeStyle(2, COLORS.gold, .7).setDepth(995);
    scene.add.text(45, 18, `P1  ${p1.config.name}`, { fontFamily:FONT_FAMILY, fontSize:'21px', color:'#E9B928' }).setDepth(1002);
    scene.add.text(GAME_WIDTH - 45, 18, `${modeLabel}  ${p2.config.name}`, { fontFamily:FONT_FAMILY, fontSize:'21px', color:'#00C8FF' }).setOrigin(1,0).setDepth(1002);
    this.p1Health = new HealthBar(scene, 45, 58, 455, false);
    this.p2Health = new HealthBar(scene, GAME_WIDTH - 45, 58, 455, true);
    this.p1Meme = new MemeMeter(scene, 45, 690, 360, false);
    this.p2Meme = new MemeMeter(scene, GAME_WIDTH - 45, 690, 360, true);
    this.timer = scene.add.text(GAME_WIDTH / 2, 47, '60', { fontFamily:FONT_FAMILY, fontSize:'38px', color:'#F3E9D0', stroke:'#050505', strokeThickness:6 }).setOrigin(.5).setDepth(1004);
    this.roundTextP1 = scene.add.text(45, 83, '☆ ☆', { fontFamily:FONT_FAMILY, fontSize:'19px', color:'#E9B928' }).setDepth(1002);
    this.roundTextP2 = scene.add.text(GAME_WIDTH - 45, 83, '☆ ☆', { fontFamily:FONT_FAMILY, fontSize:'19px', color:'#00C8FF' }).setOrigin(1,0).setDepth(1002);
    this.p1Special = scene.add.text(45, 655, '', { fontFamily:FONT_FAMILY, fontSize:'13px', color:'#E9B928' }).setDepth(1004);
    this.p2Special = scene.add.text(GAME_WIDTH - 45, 655, '', { fontFamily:FONT_FAMILY, fontSize:'13px', color:'#00C8FF' }).setOrigin(1,0).setDepth(1004);
    this.help = scene.add.text(GAME_WIDTH / 2, 635, 'P1: WASD / F G H / S+H ULT    •    P2: ARROWS / J K L / ↓+L ULT    •    ESC PAUSE    •    M MUTE', { fontFamily:FONT_FAMILY, fontSize:'14px', color:'#d8d0bf', backgroundColor:'#050505aa', padding:{x:10,y:5} }).setOrigin(.5).setDepth(1005);
    scene.tweens.add({ targets:this.help, alpha:.28, delay:4500, duration:900 });
  }

  update(p1: Fighter, p2: Fighter, remainingMs: number, p1Wins: number, p2Wins: number): void {
    this.p1Health.update(p1.hp); this.p2Health.update(p2.hp);
    this.p1Meme.update(p1.memeEnergy); this.p2Meme.update(p2.memeEnergy);
    this.timer.setText(`${Math.max(0, Math.ceil(remainingMs / 1000))}`);
    this.roundTextP1.setText(`${p1Wins >= 1 ? '★' : '☆'} ${p1Wins >= 2 ? '★' : '☆'}`);
    this.roundTextP2.setText(`${p2Wins >= 1 ? '★' : '☆'} ${p2Wins >= 2 ? '★' : '☆'}`);
    const now = this.timer.scene.time.now;
    const p1Cd = Math.max(0, p1.nextSpecialAt - now);
    const p2Cd = Math.max(0, p2.nextSpecialAt - now);
    this.p1Special.setText(`${p1.config.special.name}: ${p1Cd <= 0 ? 'READY' : `${(p1Cd/1000).toFixed(1)}s`}`);
    this.p2Special.setText(`${p2.config.special.name}: ${p2Cd <= 0 ? 'READY' : `${(p2Cd/1000).toFixed(1)}s`}`);
  }
}
