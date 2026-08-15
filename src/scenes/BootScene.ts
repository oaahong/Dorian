import * as Phaser from 'phaser';
import { FIGHTERS } from '../fighters/fighterData';
import { SpriteExtractor } from '../systems/SpriteExtractor';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';

export class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    const label = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 18, 'LOADING MEME CATS...', {
      fontFamily: FONT_FAMILY, fontSize: '28px', color: '#E9B928', stroke: '#050505', strokeThickness: 6,
    }).setOrigin(.5);
    const barBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 35, 520, 22, 0x111111).setStrokeStyle(2, COLORS.gold);
    const bar = this.add.rectangle(GAME_WIDTH / 2 - 254, GAME_HEIGHT / 2 + 35, 0, 14, COLORS.gold).setOrigin(0, .5);
    this.load.on('progress', (value: number) => { bar.displayWidth = 508 * value; });
    this.load.on('loaderror', (file: { key?: string }) => console.warn(`[Boot] Asset failed: ${file.key ?? 'unknown'}`));
    this.load.once('complete', () => { label.setText('CUTTING JPEG FIGHTERS...'); barBg.setStrokeStyle(2, COLORS.cyan); });
    FIGHTERS.forEach((fighter) => this.load.image(fighter.cardTexture, `assets/cards/card-${fighter.number}.png`));
  }

  create(): void {
    new SpriteExtractor(this).extractAll(FIGHTERS);
    this.time.delayedCall(80, () => this.scene.start('TitleScene'));
  }
}
