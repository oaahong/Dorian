import * as Phaser from 'phaser';
import { COLORS } from '../utils/constants';

export class HealthBar {
  private readonly container: Phaser.GameObjects.Container;
  private readonly lag: Phaser.GameObjects.Rectangle;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly valueText: Phaser.GameObjects.Text;
  private lastHp = 100;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, alignRight = false) {
    this.container = scene.add.container(x, y).setDepth(1000);
    const bg = scene.add.rectangle(0, 0, width, 25, 0x0a0a0a, .95).setStrokeStyle(3, COLORS.gold, .95).setOrigin(alignRight ? 1 : 0, .5);
    this.lag = scene.add.rectangle(alignRight ? 0 : 0, 0, width - 6, 17, 0xffc14d, .9).setOrigin(alignRight ? 1 : 0, .5);
    this.fill = scene.add.rectangle(alignRight ? 0 : 0, 0, width - 6, 17, COLORS.red, .95).setOrigin(alignRight ? 1 : 0, .5);
    this.valueText = scene.add.text(alignRight ? -width - 52 : width + 10, -10, '100', { fontFamily:'monospace', fontSize:'18px', color:'#f3e9d0' });
    this.container.add([bg, this.lag, this.fill, this.valueText]);
  }

  update(hp: number): void {
    const clamped = Phaser.Math.Clamp(hp, 0, 100);
    const width = this.fill.width;
    this.fill.displayWidth = width * (clamped / 100);
    this.valueText.setText(`${Math.ceil(clamped)}`);
    if (clamped < this.lastHp) {
      this.container.scene.tweens.killTweensOf(this.lag);
      this.container.scene.tweens.add({ targets:this.lag, displayWidth: width * (clamped / 100), duration:520, delay:110, ease:'Cubic.easeOut' });
      this.container.scene.tweens.add({ targets:this.container, x:this.container.x + 5, duration:35, yoyo:true, repeat:2 });
    } else if (clamped > this.lastHp) {
      this.lag.displayWidth = width * (clamped / 100);
    }
    this.lastHp = clamped;
  }
}
