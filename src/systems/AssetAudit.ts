import Phaser from 'phaser';
import type {FighterConfig} from '../fighters/FighterConfig';

export interface RuntimeAssetAuditResult {fighterId:string;card:boolean;poses:number;missing:string[];}

export class AssetAudit {
  static inspect(scene:Phaser.Scene,fighters:FighterConfig[]):RuntimeAssetAuditResult[]{
    return fighters.map(f=>{
      const missing:string[]=[];
      const card=scene.textures.exists(`card-${f.id}`);
      if(!card)missing.push(`card-${f.id}`);
      let poses=0;
      for(let i=1;i<=30;i++){
        const key=`${f.id}-pose-${String(i).padStart(2,'0')}`;
        if(scene.textures.exists(key))poses++;else missing.push(key);
      }
      return {fighterId:f.id,card,poses,missing};
    });
  }

  static assertComplete(scene:Phaser.Scene,fighters:FighterConfig[]){
    const report=this.inspect(scene,fighters);
    const failures=report.filter(x=>x.missing.length>0);
    if(failures.length)throw new Error(`Asset audit failed: ${failures.map(x=>`${x.fighterId}(${x.missing.length})`).join(', ')}`);
    return report;
  }
}
