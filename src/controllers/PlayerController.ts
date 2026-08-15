import * as Phaser from 'phaser';
import type { Controller, FighterIntent } from './Controller';
import { INPUT_BUFFER_MS } from '../utils/constants';

interface PlayerKeyMap {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  light: Phaser.Input.Keyboard.Key;
  heavy: Phaser.Input.Keyboard.Key;
  special: Phaser.Input.Keyboard.Key;
}

export class PlayerController implements Controller {
  private readonly keys: PlayerKeyMap;
  private lastDownPressedAt = -Infinity;

  constructor(scene: Phaser.Scene, player: 1 | 2) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input unavailable');

    keyboard.enabled = true;

    if (player === 1) {
      this.keys = {
        left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        light: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F),
        heavy: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G),
        special: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H),
      };
    } else {
      this.keys = {
        left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        light: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
        heavy: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
        special: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L),
      };
    }
  }

  update(nowMs: number): FighterIntent {
    if (Phaser.Input.Keyboard.JustDown(this.keys.down)) this.lastDownPressedAt = nowMs;

    const specialPressed = Phaser.Input.Keyboard.JustDown(this.keys.special);
    const downBuffered = this.keys.down.isDown || nowMs - this.lastDownPressedAt <= INPUT_BUFFER_MS;
    const left = this.keys.left.isDown;
    const right = this.keys.right.isDown;

    return {
      move: left === right ? 0 : left ? -1 : 1,
      crouch: this.keys.down.isDown,
      jumpPressed: Phaser.Input.Keyboard.JustDown(this.keys.up),
      lightPressed: Phaser.Input.Keyboard.JustDown(this.keys.light),
      heavyPressed: Phaser.Input.Keyboard.JustDown(this.keys.heavy),
      specialPressed: specialPressed && !downBuffered,
      ultimatePressed: specialPressed && downBuffered,
    };
  }

  reset(): void {
    this.lastDownPressedAt = -Infinity;
  }
}
