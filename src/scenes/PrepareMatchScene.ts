import * as Phaser from 'phaser';
import { getFighterConfig } from '../fighters/fighterData';
import type { FighterConfig } from '../fighters/FighterConfig';
import { SpriteExtractor } from '../systems/SpriteExtractor';
import { gameState } from '../systems/GameState';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';

/**
 * Loads the two chosen fighters' full-resolution cards and cuts their poses.
 *
 * This used to happen at boot for all eight fighters: 26 MB of PNG and 104
 * synchronous canvas passes before the title screen appeared. The cards are only
 * ever *displayed* at 238x298 or smaller, so the menus now use small thumbnails
 * and the full art is fetched only once the match is known — about 6 MB and 26
 * passes instead.
 *
 * It matters most online, where both players wait for whichever of them is
 * slower to be ready.
 */
export class PrepareMatchScene extends Phaser.Scene {
  private nextScene = 'VsScene';

  constructor() {
    super('PrepareMatchScene');
  }

  init(data: { next?: string }): void {
    this.nextScene = data?.next ?? 'VsScene';
  }

  preload(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    const label = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 18, 'LOADING FIGHTERS...', {
      fontFamily: FONT_FAMILY, fontSize: '28px', color: '#E9B928', stroke: '#050505', strokeThickness: 6,
    }).setOrigin(.5);
    const barBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 35, 520, 22, 0x111111)
      .setStrokeStyle(2, COLORS.gold);
    const bar = this.add.rectangle(GAME_WIDTH / 2 - 254, GAME_HEIGHT / 2 + 35, 0, 14, COLORS.gold)
      .setOrigin(0, .5);

    this.load.on('progress', (value: number) => { bar.displayWidth = 508 * value; });
    this.load.on('loaderror', (file: { key?: string }) =>
      console.warn(`[Prepare] Asset failed: ${file.key ?? 'unknown'}`));
    this.load.once('complete', () => {
      label.setText('CUTTING JPEG FIGHTERS...');
      barBg.setStrokeStyle(2, COLORS.cyan);
    });

    for (const fighter of this.matchFighters()) {
      if (this.textures.exists(fighter.cardTexture)) continue;
      this.load.image(fighter.cardTexture, `assets/cards/card-${fighter.number}.png`);
    }
  }

  create(): void {
    new SpriteExtractor(this).extractAll(this.matchFighters());
    // A frame's delay so the "cutting" label is actually seen when extraction is
    // fast, and so the loading screen is not swapped out mid-layout.
    this.time.delayedCall(60, () => this.scene.start(this.nextScene));
  }

  /** The fighters this match needs, deduplicated for a mirror match. */
  private matchFighters(): FighterConfig[] {
    const ids = [...new Set([gameState.data.p1Character, gameState.data.p2Character])];
    return ids.map(getFighterConfig);
  }
}
