import * as Phaser from 'phaser';
import { FIGHTERS } from '../fighters/fighterData';
import { gameState } from '../systems/GameState';
import { AudioManager } from '../systems/AudioManager';
import { COLORS, FONT_FAMILY } from '../utils/constants';

interface CursorState {
  index: number;
  locked: boolean;
  color: number;
  label: string;
}

/**
 * Character select intentionally uses KeyboardEvent.code instead of key.
 * On macOS / Windows with a CJK IME active, event.key can become "Process"
 * or composition text for WASD/F/G. event.code always tracks the physical key,
 * which makes the selector work regardless of the active input method.
 */
export class CharacterSelectScene extends Phaser.Scene {
  private p1: CursorState = { index: 0, locked: false, color: COLORS.gold, label: 'P1' };
  private p2: CursorState = { index: 7, locked: false, color: COLORS.cyan, label: 'P2' };
  private cards: Phaser.GameObjects.Image[] = [];
  private frames: Phaser.GameObjects.Rectangle[] = [];
  private p1Frame!: Phaser.GameObjects.Rectangle;
  private p2Frame!: Phaser.GameObjects.Rectangle;
  private detailCard!: Phaser.GameObjects.Image;
  private detailText!: Phaser.GameObjects.Text;
  private focusOwner: 1 | 2 = 1;
  private inputLockedUntil = 0;
  private leaving = false;

  constructor() {
    super('CharacterSelectScene');
  }

  create(): void {
    this.p1 = { index: 0, locked: false, color: COLORS.gold, label: 'P1' };
    this.p2 = { index: 7, locked: false, color: COLORS.cyan, label: 'P2' };
    this.cards = [];
    this.frames = [];
    this.focusOwner = 1;
    this.leaving = false;

    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.add.text(32, 20, 'CHOOSE YOUR MEME', {
      fontFamily: FONT_FAMILY,
      fontSize: '38px',
      color: '#E9B928',
      stroke: '#050505',
      strokeThickness: 7,
    });
    this.add.text(32, 65, gameState.data.mode === 'cpu' ? 'P1 SELECT • CPU WILL RANDOMIZE' : 'P1 + P2 SELECT', {
      fontFamily: FONT_FAMILY,
      fontSize: '17px',
      color: '#F3E9D0',
    });

    const startX = 112;
    const startY = 190;
    const gapX = 170;
    const gapY = 245;

    FIGHTERS.forEach((fighter, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      const x = startX + col * gapX;
      const y = startY + row * gapY;

      const frame = this.add.rectangle(x, y, 146, 190, 0x090909, 1).setStrokeStyle(2, 0x5f5226, 0.9);
      const card = this.add.image(x, y, fighter.cardTexture).setDisplaySize(136, 170).setInteractive({ useHandCursor: true });

      card.on('pointerover', () => {
        if (this.leaving) return;
        if (!this.p1.locked) {
          this.p1.index = index;
          this.focusOwner = 1;
        } else if (gameState.data.mode === 'pvp' && !this.p2.locked) {
          this.p2.index = index;
          this.focusOwner = 2;
        }
        this.updateSelectionVisuals();
      });

      // Mouse is optional, but a click also confirms so the screen can never
      // become a keyboard-only dead end.
      card.on('pointerdown', () => {
        if (this.leaving || this.time.now < this.inputLockedUntil) return;
        if (!this.p1.locked) {
          this.p1.index = index;
          this.focusOwner = 1;
          this.confirmP1();
        } else if (gameState.data.mode === 'pvp' && !this.p2.locked) {
          this.p2.index = index;
          this.p2.locked = true;
          gameState.data.p2Character = FIGHTERS[index]!.id;
          this.focusOwner = 2;
        }
        AudioManager.play('menu');
        this.updateSelectionVisuals();
        this.tryFinishSelection();
      });

      this.add.text(x, y + 103, `${fighter.number} ${fighter.shortName}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        color: '#F3E9D0',
      }).setOrigin(0.5);

      this.frames.push(frame);
      this.cards.push(card);
    });

    this.p1Frame = this.add.rectangle(0, 0, 156, 200, 0x000000, 0).setStrokeStyle(5, COLORS.gold, 1).setDepth(10);
    this.p2Frame = this.add.rectangle(0, 0, 166, 210, 0x000000, 0).setStrokeStyle(4, COLORS.cyan, 1).setDepth(11).setAlpha(gameState.data.mode === 'pvp' ? 1 : 0);

    this.detailCard = this.add.image(950, 275, FIGHTERS[0]!.cardTexture).setDisplaySize(238, 298);
    this.detailText = this.add.text(795, 445, '', {
      fontFamily: FONT_FAMILY,
      fontSize: '18px',
      color: '#F3E9D0',
      lineSpacing: 8,
      wordWrap: { width: 400 },
    });

    this.add.rectangle(972, 360, 470, 640, 0x090909, 0.65).setStrokeStyle(2, COLORS.gold, 0.55).setDepth(-1);

    const help = gameState.data.mode === 'cpu'
      ? 'WASD / ARROWS MOVE  •  F / ENTER CONFIRM  •  G / ESC BACK'
      : 'P1 WASD + F     P2 ARROWS + J     G / ESC BACK';
    this.add.text(960, 675, help, {
      fontFamily: FONT_FAMILY,
      fontSize: '15px',
      color: '#bfb49c',
    }).setOrigin(0.5);

    this.inputLockedUntil = this.time.now + 300;
    this.updateSelectionVisuals();

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.enabled = true;
      keyboard.on('keydown', this.onKey, this);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', this.onKey, this));
    }
  }

  private onKey(event: KeyboardEvent): void {
    if (this.leaving || this.time.now < this.inputLockedUntil) return;

    const code = event.code;
    if (code.startsWith('Arrow') || code === 'Space') event.preventDefault();

    if (code === 'KeyM') {
      AudioManager.toggleMute();
      return;
    }
    if (code === 'KeyG' || code === 'Escape') {
      AudioManager.play('menu');
      this.leaving = true;
      this.scene.start('ModeSelectScene');
      return;
    }

    let changed = false;

    if (!this.p1.locked) {
      const cpuArrowFallback = gameState.data.mode === 'cpu';
      if (code === 'KeyW' || (cpuArrowFallback && code === 'ArrowUp')) {
        this.moveCursor(this.p1, 0, -1);
        this.focusOwner = 1;
        changed = true;
      } else if (code === 'KeyS' || (cpuArrowFallback && code === 'ArrowDown')) {
        this.moveCursor(this.p1, 0, 1);
        this.focusOwner = 1;
        changed = true;
      } else if (code === 'KeyA' || (cpuArrowFallback && code === 'ArrowLeft')) {
        this.moveCursor(this.p1, -1, 0);
        this.focusOwner = 1;
        changed = true;
      } else if (code === 'KeyD' || (cpuArrowFallback && code === 'ArrowRight')) {
        this.moveCursor(this.p1, 1, 0);
        this.focusOwner = 1;
        changed = true;
      } else if (code === 'KeyF' || (cpuArrowFallback && (code === 'Enter' || code === 'Space'))) {
        this.confirmP1();
        changed = true;
      }
    }

    if (gameState.data.mode === 'pvp' && !this.p2.locked) {
      if (code === 'ArrowUp') {
        this.moveCursor(this.p2, 0, -1);
        this.focusOwner = 2;
        changed = true;
      } else if (code === 'ArrowDown') {
        this.moveCursor(this.p2, 0, 1);
        this.focusOwner = 2;
        changed = true;
      } else if (code === 'ArrowLeft') {
        this.moveCursor(this.p2, -1, 0);
        this.focusOwner = 2;
        changed = true;
      } else if (code === 'ArrowRight') {
        this.moveCursor(this.p2, 1, 0);
        this.focusOwner = 2;
        changed = true;
      } else if (code === 'KeyJ') {
        this.p2.locked = true;
        gameState.data.p2Character = FIGHTERS[this.p2.index]!.id;
        this.focusOwner = 2;
        changed = true;
      }
    }

    if (changed) {
      AudioManager.play('menu');
      this.updateSelectionVisuals();
      this.tryFinishSelection();
    }
  }

  private confirmP1(): void {
    if (this.p1.locked) return;
    this.p1.locked = true;
    gameState.data.p1Character = FIGHTERS[this.p1.index]!.id;

    if (gameState.data.mode === 'cpu') {
      const cpuId = gameState.pickCpuOpponent(this.p1.index);
      gameState.data.p2Character = cpuId;
      this.p2.index = FIGHTERS.findIndex((fighter) => fighter.id === cpuId);
      this.p2.locked = true;
    }
  }

  private tryFinishSelection(): void {
    if (!this.p1.locked) return;
    if (gameState.data.mode === 'pvp' && !this.p2.locked) return;
    this.finishSelection();
  }

  private finishSelection(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.inputLockedUntil = Number.POSITIVE_INFINITY;
    gameState.resetMatch();
    gameState.rollMatchSetup();
    this.cameras.main.flash(100, 255, 255, 255);
    this.time.delayedCall(340, () => this.scene.start('VsScene'));
  }

  private moveCursor(cursor: CursorState, dx: number, dy: number): void {
    let col = cursor.index % 4;
    let row = Math.floor(cursor.index / 4);
    col = (col + dx + 4) % 4;
    row = (row + dy + 2) % 2;
    cursor.index = row * 4 + col;
  }

  private updateSelectionVisuals(): void {
    const pos = (index: number) => ({
      x: 112 + (index % 4) * 170,
      y: 190 + Math.floor(index / 4) * 245,
    });

    const p1 = pos(this.p1.index);
    this.p1Frame.setPosition(p1.x, p1.y).setAlpha(this.p1.locked ? 0.55 : 1);

    const p2 = pos(this.p2.index);
    this.p2Frame.setPosition(p2.x, p2.y).setAlpha(gameState.data.mode === 'pvp' ? (this.p2.locked ? 0.55 : 1) : 0);

    const focusIndex = this.focusOwner === 1 ? this.p1.index : this.p2.index;
    this.cards.forEach((card, i) => card.setDisplaySize(i === focusIndex ? 143 : 136, i === focusIndex ? 179 : 170));

    const focused = FIGHTERS[this.focusOwner === 1 ? this.p1.index : this.p2.index]!;
    this.detailCard.setTexture(focused.cardTexture);
    const bars = (value: number) => '■'.repeat(value) + '□'.repeat(5 - value);

    const lockLabel = this.focusOwner === 1
      ? (this.p1.locked ? 'P1 LOCKED' : 'P1 FOCUS')
      : (this.p2.locked ? 'P2 LOCKED' : 'P2 FOCUS');

    this.detailText.setText([
      `${lockLabel}  ${focused.name}`,
      `${focused.archetype}`,
      '',
      `HP       ${bars(focused.hpStat)}`,
      `ATTACK   ${bars(focused.attackStat)}`,
      `SPEED    ${bars(focused.speedStat)}`,
      `RANGE    ${bars(focused.rangeStat)}`,
      `CONTROL  ${bars(focused.controlStat)}`,
      '',
      `SPECIAL  ${focused.special.name}`,
      `ULTIMATE ${focused.ultimate.name}`,
      '',
      focused.tagline,
    ]).setColor(this.focusOwner === 1 ? '#E9B928' : '#00C8FF');
  }
}
