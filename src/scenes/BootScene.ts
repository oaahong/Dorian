import Phaser from 'phaser';
import {FIGHTERS} from '../data/fighterData';
import {SpriteExtractor} from '../systems/SpriteExtractor';
import {AssetAudit} from '../systems/AssetAudit';
import {SkillAssetLoader} from '../systems/SkillAssetLoader';
export class BootScene extends Phaser.Scene{
 constructor(){super('BootScene');}
 preload(){
  const bg=this.add.rectangle(640,360,900,32,0x171717).setStrokeStyle(2,0xf3cc4b);const bar=this.add.rectangle(195,360,0,22,0xf3cc4b).setOrigin(0,.5);const t=this.add.text(640,305,'LOADING CURSED JPEG FIGHTERS…',{fontFamily:'monospace',fontSize:'24px',color:'#ffe76b'}).setOrigin(.5);
  this.load.on('progress',(v:number)=>{bar.width=890*v});
  for(const f of FIGHTERS)SpriteExtractor.queueFighter(this.load,f);SkillAssetLoader.queue(this.load);
  this.load.once('complete',()=>{bg.destroy();bar.destroy();t.destroy();});
 }
 create(){AssetAudit.assertComplete(this,FIGHTERS);this.scene.start('TitleScene');}
}
