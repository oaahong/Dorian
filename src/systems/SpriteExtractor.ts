import Phaser from 'phaser';
import type {FighterConfig} from '../fighters/FighterConfig';

/**
 * Browser-side half of the asset pipeline. Heavy pixel processing is done at build time
 * by scripts/extract_poses.py, then this class registers the resulting transparent poses.
 */
export class SpriteExtractor {
  static queueFighter(loader:Phaser.Loader.LoaderPlugin,fighter:FighterConfig){
    loader.image(`card-${fighter.id}`,fighter.cardTexture);
    for(let i=1;i<=30;i++){
      const id=String(i);
      const pose=fighter.sheetProfile.poses[id];
      if(!pose)throw new Error(`Missing pose ${i} for ${fighter.id}`);
      loader.image(`${fighter.id}-pose-${id.padStart(2,'0')}`,pose.path);
    }
  }

  static expectedTextureKeys(fighter:FighterConfig){
    return Array.from({length:30},(_,i)=>`${fighter.id}-pose-${String(i+1).padStart(2,'0')}`);
  }
}
