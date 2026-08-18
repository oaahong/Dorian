import type * as Phaser from 'phaser';

/**
 * Scale an image to a target height, whatever its source resolution is.
 *
 * Every sheet this game draws from is framed differently — poses, skill cells,
 * cut-in portraits and the derived weapon modules all come out of separate
 * pipelines, and their cells run from 88x226 to 363x169. Giving any of them a
 * fixed scale makes some fighters twice the size of others. Fitting to a height
 * is the only rule that produces a consistent apparent size across all of them.
 */
export function fitToHeight(sprite: Phaser.GameObjects.Image, height: number): void {
  const source = sprite.texture.getSourceImage() as { height: number };
  sprite.setScale(height / Math.max(1, source.height));
}
