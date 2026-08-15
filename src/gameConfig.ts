import * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './utils/constants';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { OnlineLobbyScene } from './scenes/OnlineLobbyScene';
import { ModeSelectScene } from './scenes/ModeSelectScene';
import { CharacterSelectScene } from './scenes/CharacterSelectScene';
import { PrepareMatchScene } from './scenes/PrepareMatchScene';
import { VsScene } from './scenes/VsScene';
import { BattleScene } from './scenes/BattleScene';
import { ResultScene } from './scenes/ResultScene';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#050505',
  scene: [BootScene, TitleScene, ModeSelectScene,
    OnlineLobbyScene, CharacterSelectScene, PrepareMatchScene, VsScene, BattleScene, ResultScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  render: {
    antialias: true,
    roundPixels: true,
    powerPreference: 'high-performance',
  },
  input: {
    keyboard: {
      /**
       * Stops arrow keys and space from scrolling the page.
       *
       * This must go through Phaser's capture list rather than a hand-rolled
       * `window.addEventListener('keydown', e => e.preventDefault())`. A manual
       * listener registered before `new Phaser.Game()` runs first, and Phaser's
       * KeyboardManager drops any event whose `defaultPrevented` is already true
       * — which silently killed every arrow key and space press in the game,
       * leaving Player 2 unable to move, jump or crouch. Phaser's own capture
       * calls `preventDefault` *after* queueing the event, so scrolling is
       * blocked and the game still receives the key.
       */
      capture: [
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
      ],
    },
  },
  autoFocus: true,
};
