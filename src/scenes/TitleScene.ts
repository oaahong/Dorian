import * as Phaser from 'phaser';
import { AudioManager } from '../systems/AudioManager';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';

export class TitleScene extends Phaser.Scene {
  private transitioning = false;
  constructor() { super('TitleScene'); }

  create(): void {
    this.transitioning = false;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.drawPerspectiveGrid();
    this.add.text(GAME_WIDTH / 2, 160, 'MEME CAT', {
      fontFamily: FONT_FAMILY, fontSize: '92px', color: '#F3E9D0', stroke: '#2a1500', strokeThickness: 12,
    }).setOrigin(.5).setShadow(8, 8, '#E9B928', 0, false, true).setAngle(-1.5);
    this.add.text(GAME_WIDTH / 2, 260, 'FIGHTER', {
      fontFamily: FONT_FAMILY, fontSize: '110px', color: '#FF3B30', stroke: '#050505', strokeThickness: 14,
    }).setOrigin(.5).setShadow(7, 7, '#E9B928', 0, false, true).setAngle(1.2);
    this.add.text(GAME_WIDTH / 2, 335, 'ARCADE CAT BRAWL', {
      fontFamily: FONT_FAMILY, fontSize: '28px', color: '#E9B928', letterSpacing: 5,
    }).setOrigin(.5);
    /**
     * The prompt's backdrop is a separate rectangle, not the text's own
     * `backgroundColor`.
     *
     * Phaser's alpha applies to the whole rendered text object, background fill
     * included, so the blink tween used to fade the plate along with the letters
     * — and at the bottom of every cycle the red perspective grid showed straight
     * through the words. Tweening only the text leaves the plate opaque.
     */
    const prompt = this.add.text(GAME_WIDTH / 2, 500, 'PRESS ANY KEY', {
      fontFamily: FONT_FAMILY, fontSize: '34px', color: '#F3E9D0',
    }).setOrigin(.5).setStroke('#050505', 6).setDepth(2);
    this.plate(prompt, 0.92);
    this.tweens.add({ targets: prompt, alpha: .25, duration: 600, yoyo: true, repeat: -1 });

    // The footer sits in the densest part of the grid, where #8c806b was barely
    // legible. Same cream the other menus use for help text, over its own plate.
    const footer = this.add.text(GAME_WIDTH / 2, 635, 'LOW-RES JPEG • HIGH-RES VIOLENCE • M = MUTE', {
      fontFamily: FONT_FAMILY, fontSize: '15px', color: '#bfb49c',
    }).setOrigin(.5).setDepth(2);
    this.plate(footer, 0.8);

    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.once('keydown', async (event: KeyboardEvent) => {
      if (this.transitioning) return;
      this.transitioning = true;
      await AudioManager.unlock();
      if (event.code === 'KeyM') AudioManager.toggleMute();
      AudioManager.play('menu');
      this.cameras.main.flash(90, 255, 255, 255);
      this.time.delayedCall(130, () => this.scene.start('ModeSelectScene'));
    });
  }

  /** A backdrop sized to what it sits behind, so no second set of numbers can drift from the first. */
  private plate(text: Phaser.GameObjects.Text, alpha: number): void {
    const bounds = text.getBounds();
    this.add
      .rectangle(bounds.centerX, bounds.centerY, bounds.width + 44, bounds.height + 22, COLORS.bg, alpha)
      .setDepth(1);
  }

  private drawPerspectiveGrid(): void {
    const g = this.add.graphics().setAlpha(.34);
    g.lineStyle(1, 0xff3126, .65);
    const horizon = 390;
    for (let i = -12; i <= 12; i += 1) {
      g.beginPath(); g.moveTo(GAME_WIDTH / 2, horizon); g.lineTo(GAME_WIDTH / 2 + i * 95, GAME_HEIGHT); g.strokePath();
    }
    for (let y = horizon + 18; y < GAME_HEIGHT; y += 25) {
      const t = (y - horizon) / (GAME_HEIGHT - horizon);
      const yy = horizon + t * t * (GAME_HEIGHT - horizon);
      g.lineBetween(0, yy, GAME_WIDTH, yy);
    }
    for (let i = 0; i < 18; i += 1) {
      const line = this.add.rectangle(Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(30, 360), Phaser.Math.Between(20, 120), 2, COLORS.gold, .10);
      this.tweens.add({ targets: line, x: line.x + Phaser.Math.Between(-40, 40), alpha: 0, duration: Phaser.Math.Between(900, 2100), yoyo: true, repeat: -1 });
    }
  }
}
