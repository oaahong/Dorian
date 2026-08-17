import Phaser from 'phaser';
import type {FighterRuntime} from '../fighters/Fighter';
import {clamp} from '../utils/constants';
export class BattleHUD {
 private g:Phaser.GameObjects.Graphics;private p1Text:Phaser.GameObjects.Text;private p2Text:Phaser.GameObjects.Text;private timer:Phaser.GameObjects.Text;private round:Phaser.GameObjects.Text;
 private lag1=100;private lag2=100;
 constructor(private scene:Phaser.Scene,private p1:FighterRuntime,private p2:FighterRuntime){
  this.g=scene.add.graphics().setDepth(100);this.p1Text=scene.add.text(48,22,p1.config.shortName,{fontSize:'24px',fontFamily:'Impact, sans-serif',stroke:'#000',strokeThickness:5}).setDepth(101);
  this.p2Text=scene.add.text(1232,22,p2.config.shortName,{fontSize:'24px',fontFamily:'Impact, sans-serif',stroke:'#000',strokeThickness:5}).setOrigin(1,0).setDepth(101);
  this.timer=scene.add.text(640,28,'60',{fontSize:'42px',fontFamily:'Impact, sans-serif',color:'#ffe061',stroke:'#000',strokeThickness:7}).setOrigin(.5,0).setDepth(101);
  this.round=scene.add.text(640,77,'0 - 0',{fontSize:'18px',fontFamily:'monospace',color:'#fff'}).setOrigin(.5).setDepth(101);
 }
 update(timerFrames:number,w1:number,w2:number){this.lag1+=(this.p1.hp-this.lag1)*.08;this.lag2+=(this.p2.hp-this.lag2)*.08;this.g.clear();
  this.g.fillStyle(0x111111,.88).fillRoundedRect(42,55,500,34,8).fillRoundedRect(738,55,500,34,8);
  this.g.fillStyle(0x7c2525).fillRect(48,61,480*clamp(this.lag1/100,0,1),22);this.g.fillRect(1232-480*clamp(this.lag2/100,0,1),61,480*clamp(this.lag2/100,0,1),22);
  this.g.fillStyle(0x42d96b).fillRect(48,61,480*clamp(this.p1.hp/100,0,1),22);this.g.fillRect(1232-480*clamp(this.p2.hp/100,0,1),61,480*clamp(this.p2.hp/100,0,1),22);
  this.g.fillStyle(0x16111e,.9).fillRoundedRect(48,94,360,18,5).fillRoundedRect(872,94,360,18,5);this.g.fillStyle(0xb35cff).fillRect(52,98,352*this.p1.meter/100,10).fillRect(1228-352*this.p2.meter/100,98,352*this.p2.meter/100,10);
  this.g.lineStyle(2,0xf4d35e,1).strokeRoundedRect(42,55,500,34,8).strokeRoundedRect(738,55,500,34,8);
  this.g.fillStyle(0xffffff);this.scene.add;this.timer.setText(String(Math.ceil(timerFrames/60)));this.round.setText(`${w1} - ${w2}`);
  const m1=this.p1.meter>=100?'MEME READY':`${Math.floor(this.p1.meter)} MEME`;const m2=this.p2.meter>=100?'MEME READY':`${Math.floor(this.p2.meter)} MEME`;this.p1Text.setText(`${this.p1.config.shortName}   ${Math.ceil(this.p1.hp)} HP   ${m1}`);this.p2Text.setText(`${m2}   ${Math.ceil(this.p2.hp)} HP   ${this.p2.config.shortName}`);
 }
 destroy(){this.g.destroy();this.p1Text.destroy();this.p2Text.destroy();this.timer.destroy();this.round.destroy();}
}
