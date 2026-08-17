import Phaser from 'phaser';
import {GAME_W,GAME_H,GROUND_Y} from '../utils/constants';
export type StageId='freezer'|'magicForest'|'diningTable';
export class StageRenderer {
 static draw(scene:Phaser.Scene,id:StageId){const g=scene.add.graphics().setDepth(-20);
  if(id==='freezer'){g.fillGradientStyle(0x15263c,0x15263c,0x09101e,0x09101e,1);g.fillRect(0,0,GAME_W,GAME_H);for(let i=0;i<7;i++){g.lineStyle(3,0x78caff,.25);g.strokeRect(50+i*180,100,150,320);}g.fillStyle(0xd9f3ff,.12);g.fillRect(0,GROUND_Y,1280,110);for(let i=0;i<10;i++){g.fillStyle(0xffffff,.5);g.fillRect(80+i*120,450,60,24)}}
  else if(id==='magicForest'){g.fillGradientStyle(0x240b36,0x240b36,0x09030f,0x09030f,1);g.fillRect(0,0,1280,720);g.fillStyle(0xf0d4ff,.8);g.fillCircle(1000,130,60);g.fillStyle(0x0b0710,1);for(let x=0;x<1280;x+=120){g.fillTriangle(x,610,x+55,240+Math.random()*120,x+120,610)}for(let i=0;i<60;i++){g.fillStyle(0xffffff,Math.random()*.6+.2);g.fillCircle(Math.random()*1280,Math.random()*300,1+Math.random()*2)}}
  else {g.fillGradientStyle(0x4d281c,0x4d281c,0x17100e,0x17100e,1);g.fillRect(0,0,1280,720);g.fillStyle(0x8a4e2c);g.fillRect(0,520,1280,200);g.fillStyle(0xf1e6d1,.8);g.fillEllipse(280,540,220,80);g.fillEllipse(1000,550,240,90);g.lineStyle(8,0xc0c0c0);g.lineBetween(80,440,80,620);g.lineBetween(1200,430,1200,620)}
  return g;
 }
}
