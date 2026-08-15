import * as Phaser from 'phaser';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';

export class VFXManager {
  private readonly layer: Phaser.GameObjects.Container;
  private readonly world: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene, world: Phaser.GameObjects.Container) {
    this.world = world;
    this.layer = scene.add.container(0, 0).setDepth(900);
  }

  hitSpark(x: number, y: number, heavy = false, color = COLORS.gold): void {
    try {
      const count = heavy ? 14 : 8;
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * .2;
        const len = (heavy ? 85 : 48) * (.65 + Math.random() * .5);
        const line = this.scene.add.rectangle(x, y, len, heavy ? 7 : 4, color).setOrigin(0, .5).setRotation(angle).setAlpha(.95);
        this.layer.add(line);
        this.scene.tweens.add({ targets: line, alpha: 0, scaleX: .2, duration: heavy ? 170 : 110, ease: 'Quad.easeOut', onComplete: () => line.destroy() });
      }
    } catch (error) { console.warn('[VFX] hitSpark failed', error); }
  }

  blockSpark(x: number, y: number): void {
    const ring = this.scene.add.circle(x, y, 34, COLORS.cyan, .12).setStrokeStyle(5, COLORS.cyan, .95);
    this.layer.add(ring);
    this.scene.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 180, onComplete: () => ring.destroy() });
    this.popup('BLOCK', x, y - 70, COLORS.cyan, 26);
  }

  shockwave(x: number, y: number, color: number, size = 100): void {
    const ring = this.scene.add.circle(x, y, 20, color, .06).setStrokeStyle(7, color, .8);
    this.layer.add(ring);
    this.scene.tweens.add({ targets: ring, displayWidth: size * 2, displayHeight: size * 2, alpha: 0, duration: 280, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }

  speedLines(x: number, y: number, facing: number, color: number): void {
    for (let i = 0; i < 8; i += 1) {
      const yy = y - 90 + i * 24 + Math.random() * 12;
      const line = this.scene.add.rectangle(x - facing * 65, yy, 120 + Math.random() * 100, 3, color, .6).setOrigin(facing > 0 ? 1 : 0, .5);
      this.layer.add(line);
      this.scene.tweens.add({ targets: line, x: line.x - facing * 140, alpha: 0, duration: 180, onComplete: () => line.destroy() });
    }
  }

  afterimage(sprite: Phaser.GameObjects.Image, color: number): void {
    const ghost = this.scene.add.image(sprite.x, sprite.y, sprite.texture.key).setOrigin(sprite.originX, sprite.originY)
      .setScale(sprite.scaleX, sprite.scaleY).setFlipX(sprite.flipX).setTint(color).setAlpha(.28);
    this.layer.add(ghost);
    this.scene.tweens.add({ targets: ghost, alpha: 0, scaleX: ghost.scaleX * 1.05, scaleY: ghost.scaleY * .95, duration: 150, onComplete: () => ghost.destroy() });
  }

  pixelBlocks(color: number, count = 24): void {
    for (let i = 0; i < count; i += 1) {
      const s = Phaser.Math.Between(8, 32);
      const block = this.scene.add.rectangle(Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(70, GAME_HEIGHT - 80), s, s, color, Phaser.Math.FloatBetween(.2, .65));
      this.layer.add(block);
      this.scene.tweens.add({ targets: block, y: block.y + Phaser.Math.Between(-80, 80), x: block.x + Phaser.Math.Between(-80, 80), alpha: 0, duration: Phaser.Math.Between(220, 520), onComplete: () => block.destroy() });
    }
  }

  popup(text: string, x: number, y: number, color = COLORS.cream, size = 28): void {
    const label = this.scene.add.text(x, y, text, { fontFamily: FONT_FAMILY, fontSize: `${size}px`, color: `#${color.toString(16).padStart(6, '0')}`, stroke: '#050505', strokeThickness: 7 }).setOrigin(.5).setAngle(Phaser.Math.Between(-6, 6));
    this.layer.add(label);
    this.scene.tweens.add({ targets: label, y: y - 45, scale: 1.25, alpha: 0, duration: 520, ease: 'Back.easeOut', onComplete: () => label.destroy() });
  }

  memePopup(x: number, y: number): void {
    if (Math.random() > .13) return;
    const words = ['BONK!', 'WHAT!?', 'OK!', 'BRUH', 'MEOW', 'CRITICAL MEME'];
    this.popup(words[Math.floor(Math.random() * words.length)]!, x, y - 110, COLORS.white, 24);
  }

  flash(color = COLORS.white, alpha = .45, duration = 90): void {
    const rect = this.scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, color, alpha).setDepth(990);
    this.scene.tweens.add({ targets: rect, alpha: 0, duration, onComplete: () => rect.destroy() });
  }

  shake(intensity = .005, duration = 120): void {
    const amount = Math.max(2, intensity * 1000);
    const originalX = this.world.x; const originalY = this.world.y;
    this.scene.tweens.addCounter({ from: 0, to: 1, duration, onUpdate: () => {
      this.world.x = originalX + Phaser.Math.FloatBetween(-amount, amount);
      this.world.y = originalY + Phaser.Math.FloatBetween(-amount, amount);
    }, onComplete: () => { this.world.x = originalX; this.world.y = originalY; } });
  }

  ultimateBackdrop(color: number, duration = 1200): Phaser.GameObjects.Rectangle {
    const overlay = this.scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, color, .62).setDepth(850);
    this.scene.tweens.add({ targets: overlay, alpha: .38, duration: duration * .65, yoyo: true, ease: 'Sine.easeInOut' });
    return overlay;
  }

  destroy(): void { this.layer.destroy(true); }
}
