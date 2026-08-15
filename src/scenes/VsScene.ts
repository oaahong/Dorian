import * as Phaser from 'phaser';
import { getFighterConfig } from '../fighters/fighterData';
import { gameState } from '../systems/GameState';
import { SpriteExtractor } from '../systems/SpriteExtractor';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';
import { AudioManager } from '../systems/AudioManager';

export class VsScene extends Phaser.Scene {
  constructor() { super('VsScene'); }
  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    const p1 = getFighterConfig(gameState.data.p1Character);
    const p2 = getFighterConfig(gameState.data.p2Character);
    for (let i=0;i<18;i+=1) this.add.rectangle(GAME_WIDTH/2, 40+i*38, GAME_WIDTH, 2, i%2?COLORS.red:COLORS.cyan, .07);
    const left = this.add.image(320, 400, SpriteExtractor.textureKey(p1.id,'idle')).setOrigin(.5,1).setFlipX(false);
    const right = this.add.image(960, 400, SpriteExtractor.textureKey(p2.id,'idle')).setOrigin(.5,1).setFlipX(true);
    this.normalize(left); this.normalize(right);
    this.add.text(170, 115, p1.name, { fontFamily:FONT_FAMILY, fontSize:'38px', color:'#E9B928', stroke:'#050505', strokeThickness:7 }).setOrigin(.5);
    this.add.text(1110, 115, p2.name, { fontFamily:FONT_FAMILY, fontSize:'38px', color:'#00C8FF', stroke:'#050505', strokeThickness:7 }).setOrigin(.5);
    const vs = this.add.text(GAME_WIDTH/2, 335, 'VS', { fontFamily:FONT_FAMILY, fontSize:'110px', color:'#FF3B30', stroke:'#F3E9D0', strokeThickness:5 }).setOrigin(.5).setScale(.2);
    this.tweens.add({ targets:vs, scale:1.15, duration:260, ease:'Back.easeOut', yoyo:true, hold:140 });
    this.cameras.main.shake(260,.008); this.cameras.main.flash(90,255,255,255); AudioManager.play('heavy');
    this.add.text(GAME_WIDTH/2, 620, `STAGE: ${gameState.data.stage.toUpperCase()}   •   BEST OF 3`, { fontFamily:FONT_FAMILY, fontSize:'20px', color:'#bfb49c' }).setOrigin(.5);
    this.time.delayedCall(1750, () => this.scene.start('BattleScene'));
  }
  private normalize(image: Phaser.GameObjects.Image): void {
    const source = image.texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const scale = Math.min(340/Math.max(1,source.height), 360/Math.max(1,source.width));
    image.setScale(scale);
  }
}
