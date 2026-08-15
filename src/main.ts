import * as Phaser from 'phaser';
import './style.css';
import { gameConfig } from './gameConfig';

const blocked = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
window.addEventListener('keydown', (event) => {
  if (blocked.has(event.code)) event.preventDefault();
}, { passive: false });

document.addEventListener('DOMContentLoaded', () => {
  new Phaser.Game(gameConfig);
});
