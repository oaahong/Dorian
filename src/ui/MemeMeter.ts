import * as Phaser from 'phaser';
import { COLORS, FONT_FAMILY } from '../utils/constants';

export class MemeMeter {
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly maxWidth: number;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, alignRight = false) {
    this.maxWidth = width - 8;
    scene.add.rectangle(x, y, width, 23, 0x050505, .95).setStrokeStyle(2, COLORS.gold, .8).setOrigin(alignRight ? 1 : 0, .5).setDepth(1000);
    this.fill = scene.add.rectangle(x + (alignRight ? -4 : 4), y, 0, 15, COLORS.purple, .92).setOrigin(alignRight ? 1 : 0, .5).setDepth(1001);
    this.label = scene.add.text(x + (alignRight ? -width / 2 : width / 2), y, 'MEME 0', { fontFamily:FONT_FAMILY, fontSize:'15px', color:'#F3E9D0', stroke:'#050505', strokeThickness:3 }).setOrigin(.5).setDepth(1002);
  }

  update(value: number): void {
    const v = Phaser.Math.Clamp(value, 0, 100);
    this.fill.displayWidth = this.maxWidth * (v / 100);
    this.label.setText(v >= 100 ? 'MEME MAX' : `MEME ${Math.floor(v)}`);
    this.fill.setFillStyle(v >= 100 ? COLORS.green : v >= 75 ? COLORS.gold : COLORS.purple, .95);
    if (v >= 100) this.label.setAlpha(.65 + Math.sin(this.label.scene.time.now / 90) * .35);
    else this.label.setAlpha(1);
  }
}
