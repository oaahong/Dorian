import * as Phaser from 'phaser';
import { getFighterConfig } from '../fighters/fighterData';
import type { FighterConfig } from '../fighters/FighterConfig';
import { POSE_NAMES, posePath, poseTextureKey } from '../fighters/poseSheet';
import { ultimateDefinitionFor } from '../fighters/ultimateDefinitions';
import { gameState } from '../systems/GameState';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';

/**
 * Loads the two chosen fighters' poses.
 *
 * This used to load a multi-megabyte card per fighter and cut thirteen panels out
 * of it with synchronous canvas passes. The poses are now extracted ahead of time
 * by `scripts/extract_poses.py`, so the scene just fetches the thirteen small PNGs
 * it needs per fighter and there is no cutting left to do.
 *
 * It still happens here rather than at boot, and for the chosen fighters only,
 * for the original reason: online, both players wait for whichever of them is
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
      label.setText('FIGHTERS READY');
      barBg.setStrokeStyle(2, COLORS.cyan);
    });

    for (const fighter of this.matchFighters()) {
      for (const pose of POSE_NAMES) {
        const key = poseTextureKey(fighter.id, pose);
        if (this.textures.exists(key)) continue;
        this.load.image(key, posePath(fighter.id, pose));
      }

      // The ultimate's cut-in: one full-screen background and one portrait. Loaded
      // here with the poses rather than at boot, for the same reason — twelve
      // backgrounds is 30 MB and a match needs two of them.
      const ultimate = ultimateDefinitionFor(fighter.id);
      if (!this.textures.exists(ultimate.backgroundTexture)) {
        this.load.image(ultimate.backgroundTexture, `assets/ultimate-backgrounds/${fighter.id}.png`);
      }
      if (!this.textures.exists(ultimate.portraitTexture)) {
        // The texture key ends in the sheet cell it came from, lower-cased.
        const cell = ultimate.portraitTexture.slice(-1).toUpperCase();
        this.load.image(ultimate.portraitTexture, `assets/skills/${fighter.id}/${cell}.png`);
      }
    }
  }

  create(): void {
    // A frame's delay so the loading screen is not swapped out mid-layout, and so
    // the "ready" label is actually seen when the poses were already cached.
    this.time.delayedCall(60, () => this.scene.start(this.nextScene));
  }

  /** The fighters this match needs, deduplicated for a mirror match. */
  private matchFighters(): FighterConfig[] {
    const ids = [...new Set([gameState.data.p1Character, gameState.data.p2Character])];
    return ids.map(getFighterConfig);
  }
}
