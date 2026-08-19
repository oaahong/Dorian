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
    /**
     * An error, not a warning. A missing texture is never cosmetic here: the
     * draw-time `textures.exists` guards turn it into a fighter that renders
     * nothing rather than a crash, so the only thing standing between a botched
     * asset rename and a silently empty screen is this line. The e2e suite
     * collects `console.error` and asserts it is empty, so a 404 fails a test
     * instead of shipping.
     */
    this.load.on('loaderror', (file: { key?: string }) =>
      console.error(`[Boot] Asset failed: ${file.key ?? 'unknown'}`));
    this.load.once('complete', () => { label.setText('READY'); barBg.setStrokeStyle(2, COLORS.cyan); });
    // Menus only ever show the card small, so boot fetches thumbnails: about
    // 960 KB rather than the 25 MB of source art. The poses the match actually
    // fights with are loaded in PrepareMatchScene, once the two are known.
    FIGHTERS.forEach((fighter) =>
      this.load.image(thumbTextureKey(fighter), `assets/thumbs/${fighter.cardTexture}.webp`));
  }

  create(): void {
    this.time.delayedCall(80, () => this.scene.start('TitleScene'));
  }
}
