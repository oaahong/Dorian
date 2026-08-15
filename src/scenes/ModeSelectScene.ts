import * as Phaser from 'phaser';
import { AudioManager } from '../systems/AudioManager';
import { gameState, type CpuDifficulty } from '../systems/GameState';
import { COLORS, FONT_FAMILY, GAME_WIDTH } from '../utils/constants';

export class ModeSelectScene extends Phaser.Scene {
  private index = 0;
  private difficultyIndex = 1;
  private optionTexts: Phaser.GameObjects.Text[] = [];
  private difficultyText!: Phaser.GameObjects.Text;
  private inputLockedUntil = 0;
  constructor() { super('ModeSelectScene'); }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.drawChrome('SELECT MODE');
    this.optionTexts = [
      this.add.text(GAME_WIDTH / 2, 300, '1P VS CPU', this.menuStyle()).setOrigin(.5),
      this.add.text(GAME_WIDTH / 2, 390, '2P VS P2', this.menuStyle()).setOrigin(.5),
    ];
    this.difficultyText = this.add.text(GAME_WIDTH / 2, 500, 'CPU DIFFICULTY: NORMAL', { fontFamily:FONT_FAMILY, fontSize:'22px', color:'#00C8FF' }).setOrigin(.5);
    this.add.text(GAME_WIDTH / 2, 590, '↑↓ / W S : SELECT     ←→ / A D : DIFFICULTY     F / ENTER : CONFIRM', { fontFamily:FONT_FAMILY, fontSize:'17px', color:'#bfb49c' }).setOrigin(.5);
    this.inputLockedUntil = this.time.now + 300;
    this.refresh();
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown', this.onKey, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => kb.off('keydown', this.onKey, this));
  }

  private onKey(event: KeyboardEvent): void {
    if (this.time.now < this.inputLockedUntil) return;
    const code = event.code;
    if (code.startsWith('Arrow') || code === 'Space') event.preventDefault();
    if (code === 'ArrowUp' || code === 'KeyW') { this.index = (this.index + 1) % 2; AudioManager.play('menu'); }
    else if (code === 'ArrowDown' || code === 'KeyS') { this.index = (this.index + 1) % 2; AudioManager.play('menu'); }
    else if (this.index === 0 && (code === 'ArrowLeft' || code === 'KeyA')) { this.difficultyIndex = (this.difficultyIndex + 2) % 3; AudioManager.play('menu'); }
    else if (this.index === 0 && (code === 'ArrowRight' || code === 'KeyD')) { this.difficultyIndex = (this.difficultyIndex + 1) % 3; AudioManager.play('menu'); }
    else if (code === 'KeyF' || code === 'Enter' || code === 'Space') {
      gameState.data.mode = this.index === 0 ? 'cpu' : 'pvp';
      gameState.data.difficulty = (['easy','normal','hard'][this.difficultyIndex] as CpuDifficulty);
      gameState.resetMatch();
      AudioManager.play('menu');
      this.scene.start('CharacterSelectScene');
      return;
    } else if (code === 'Escape' || code === 'KeyG') { this.scene.start('TitleScene'); return; }
    else if (code === 'KeyM') { AudioManager.toggleMute(); }
    this.refresh();
  }

  private refresh(): void {
    this.optionTexts.forEach((text, i) => {
      const selected = i === this.index;
      text.setColor(selected ? '#E9B928' : '#F3E9D0').setScale(selected ? 1.08 : 1).setText(`${selected ? '▶ ' : '  '}${i === 0 ? '1P VS CPU' : '2P VS P2'}${selected ? ' ◀' : ''}`);
    });
    const labels = ['EASY','NORMAL','HARD'];
    this.difficultyText.setText(this.index === 0 ? `CPU DIFFICULTY:  ◀ ${labels[this.difficultyIndex]} ▶` : 'CPU DIFFICULTY: —');
  }

  private drawChrome(title: string): void {
    this.add.rectangle(GAME_WIDTH / 2, 80, 1000, 100, 0x090909).setStrokeStyle(3, COLORS.gold);
    this.add.text(GAME_WIDTH / 2, 80, title, { fontFamily:FONT_FAMILY, fontSize:'48px', color:'#E9B928', stroke:'#050505', strokeThickness:8 }).setOrigin(.5);
    for (let y = 145; y < 700; y += 30) this.add.rectangle(GAME_WIDTH / 2, y, 1180, 1, 0xe9b928, .05);
  }

  private menuStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily:FONT_FAMILY, fontSize:'42px', color:'#F3E9D0', stroke:'#050505', strokeThickness:7, backgroundColor:'#090909', padding:{x:28,y:12} };
  }
}
