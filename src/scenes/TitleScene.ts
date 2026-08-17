import Phaser from 'phaser';import {audio} from '../systems/AudioManager';
export class TitleScene extends Phaser.Scene{
 constructor(){super('TitleScene');}
 create(){this.cameras.main.setBackgroundColor('#050505');this.add.text(640,205,'MEME FIGHT',{fontFamily:'Impact, sans-serif',fontSize:'112px',color:'#ffe45c',stroke:'#6b1d1d',strokeThickness:12}).setOrigin(.5).setAngle(-1);
  this.add.text(640,315,'迷因大亂鬥',{fontFamily:'sans-serif',fontStyle:'bold',fontSize:'52px',color:'#ffffff',stroke:'#000',strokeThickness:8}).setOrigin(.5);
  this.add.text(640,440,'PRESS ANY KEY',{fontFamily:'monospace',fontSize:'26px',color:'#c6c6c6'}).setOrigin(.5);this.add.text(640,500,'12 CHARACTER MEME FIGHTER  •  60Hz FRAME DATA  •  CURSED JPEG TECHNOLOGY',{fontFamily:'monospace',fontSize:'15px',color:'#8b8b8b'}).setOrigin(.5);
  const go=()=>{audio.ensure();audio.beep('menu');this.input.keyboard?.off('keydown',go);this.scene.start('ModeSelectScene')};this.input.keyboard?.on('keydown',go);this.events.once('shutdown',()=>this.input.keyboard?.off('keydown',go));
 }
}
