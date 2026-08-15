import * as Phaser from 'phaser';
import type { StageId } from '../systems/GameState';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, GROUND_Y } from '../utils/constants';

export class StageRenderer {
  static render(scene: Phaser.Scene, world: Phaser.GameObjects.Container, stage: StageId): void {
    const layer = scene.add.container(0, 0).setDepth(-100);
    world.add(layer);
    if (stage === 'freezer') this.freezer(scene, layer);
    else if (stage === 'magicForest') this.magicForest(scene, layer);
    else this.diningTable(scene, layer);
    this.floor(scene, layer, stage);
  }

  private static floor(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, stage: StageId): void {
    const color = stage === 'freezer' ? 0x17232a : stage === 'magicForest' ? 0x130f1b : 0x27180f;
    layer.add(scene.add.rectangle(GAME_WIDTH / 2, (GROUND_Y + GAME_HEIGHT) / 2, GAME_WIDTH, GAME_HEIGHT - GROUND_Y, color));
    layer.add(scene.add.rectangle(GAME_WIDTH / 2, GROUND_Y + 3, GAME_WIDTH, 6, COLORS.gold, .55));
    for (let x = 0; x < GAME_WIDTH; x += 90) layer.add(scene.add.rectangle(x, GROUND_Y + 45, 50, 2, 0xffffff, .05).setRotation(-.15));
  }

  private static freezer(scene: Phaser.Scene, layer: Phaser.GameObjects.Container): void {
    layer.add(scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x07131c));
    for (let i = 0; i < 5; i += 1) {
      const x = 125 + i * 258;
      layer.add(scene.add.rectangle(x, 295, 220, 430, 0x123142, .62).setStrokeStyle(8, 0x6fc6ed, .45));
      layer.add(scene.add.rectangle(x - 72, 300, 6, 395, 0xc8f3ff, .28));
      layer.add(scene.add.rectangle(x + 86, 300, 4, 395, 0xc8f3ff, .18));
      for (let row = 0; row < 4; row += 1) {
        layer.add(scene.add.rectangle(x, 150 + row * 90, 180, 44, row % 2 ? 0xe7f7ff : 0x9adbf5, .11));
        layer.add(scene.add.rectangle(x + 68, 176 + row * 90, 48, 15, 0xffffff, .65));
      }
    }
    const light = scene.add.rectangle(GAME_WIDTH / 2, 40, 970, 12, 0xd8f7ff, .7);
    layer.add(light);
    scene.tweens.add({ targets: light, alpha: .28, duration: 140, yoyo: true, repeat: -1, repeatDelay: 3600 });
  }

  private static magicForest(scene: Phaser.Scene, layer: Phaser.GameObjects.Container): void {
    layer.add(scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x100719));
    layer.add(scene.add.circle(990, 145, 82, 0xf2e8c7, .88));
    layer.add(scene.add.circle(960, 125, 82, 0x100719, .55));
    for (let i = 0; i < 40; i += 1) layer.add(scene.add.circle(Phaser.Math.Between(20, 1260), Phaser.Math.Between(45, 390), Phaser.Math.Between(1, 3), 0xdcb6ff, Phaser.Math.FloatBetween(.25, .8)));
    for (let i = 0; i < 9; i += 1) {
      const x = i * 170 - 70;
      const trunk = scene.add.rectangle(x, 385, 45, 330, 0x030205).setRotation(Phaser.Math.FloatBetween(-.12, .12));
      layer.add(trunk);
      layer.add(scene.add.triangle(x, 190, -95, 170, 0, -80, 95, 170, 0x030205));
    }
    for (let i = 0; i < 6; i += 1) layer.add(scene.add.ellipse(120 + i * 230, 510, 330, 75, 0x7b2cbf, .09));
  }

  private static diningTable(scene: Phaser.Scene, layer: Phaser.GameObjects.Container): void {
    layer.add(scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x271b14));
    layer.add(scene.add.rectangle(GAME_WIDTH / 2, 220, GAME_WIDTH, 210, 0x4a3325));
    layer.add(scene.add.rectangle(200, 210, 180, 180, 0x211812).setStrokeStyle(8, 0x805a3e));
    layer.add(scene.add.rectangle(1080, 210, 180, 180, 0x211812).setStrokeStyle(8, 0x805a3e));
    layer.add(scene.add.rectangle(GAME_WIDTH / 2, 505, 1210, 160, 0x6b4226).setStrokeStyle(8, 0x2f1c10));
    layer.add(scene.add.ellipse(320, 490, 210, 66, 0xe6e0d3).setStrokeStyle(5, 0x999999));
    layer.add(scene.add.ellipse(955, 490, 210, 66, 0xe6e0d3).setStrokeStyle(5, 0x999999));
    for (let i = 0; i < 16; i += 1) layer.add(scene.add.circle(270 + Math.random() * 100, 482 + Math.random() * 20, 6 + Math.random() * 9, i % 2 ? 0x5e9d3e : 0xb8c84c));
    for (let i = 0; i < 12; i += 1) layer.add(scene.add.circle(910 + Math.random() * 90, 482 + Math.random() * 18, 6 + Math.random() * 8, i % 2 ? 0x5e9d3e : 0xb8c84c));
    layer.add(scene.add.rectangle(555, 488, 16, 170, 0xc7c7c7).setRotation(.24));
    layer.add(scene.add.rectangle(730, 488, 16, 170, 0xc7c7c7).setRotation(-.24));
  }
}
