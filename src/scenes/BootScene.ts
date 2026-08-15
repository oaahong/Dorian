import * as Phaser from 'phaser';
import { FIGHTERS, thumbTextureKey } from '../fighters/fighterData';
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
    this.load.once('complete', () => { label.setText('READY'); barBg.setStrokeStyle(2, COLORS.cyan); });
    // Menus only ever show the card small, so boot fetches thumbnails: about
    // 560 KB rather than the 26 MB of source art. The full cards are loaded in
    // PrepareMatchScene, once it is known which two are needed.
    FIGHTERS.forEach((fighter) =>
      this.load.image(thumbTextureKey(fighter), `assets/thumbs/card-${fighter.number}.webp`));
  }

  create(): void {
    this.time.delayedCall(80, () => this.scene.start('TitleScene'));
  }
}
