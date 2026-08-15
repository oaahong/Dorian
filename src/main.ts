import * as Phaser from 'phaser';
import './style.css';
import { gameConfig } from './gameConfig';

document.addEventListener('DOMContentLoaded', () => {
  // See src/types/global.d.ts for why this handle is exposed.
  window.__MEME_CAT_GAME__ = new Phaser.Game(gameConfig);
});
