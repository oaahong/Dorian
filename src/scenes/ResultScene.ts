import * as Phaser from 'phaser';
import { getFighterConfig } from '../fighters/fighterData';
import { gameState } from '../systems/GameState';
import { endOnlineMatch } from '../net/onlineMatch';
import { poseTextureKey } from '../fighters/poseSheet';
import { COLORS, FONT_FAMILY, GAME_WIDTH } from '../utils/constants';
import { AudioManager } from '../systems/AudioManager';

export class ResultScene extends Phaser.Scene {
  private index = 0;
  private options: Phaser.GameObjects.Text[] = [];
  private inputLockedUntil = 0;
  private online = false;
  constructor() { super('ResultScene'); }
  create(): void {
    this.index = 0;
    this.options = [];
    this.cameras.main.setBackgroundColor(COLORS.bg);
    const winnerIndex = gameState.data.matchWinner ?? 1;
    const winner = getFighterConfig(winnerIndex === 1 ? gameState.data.p1Character : gameState.data.p2Character);
    const loser = getFighterConfig(winnerIndex === 1 ? gameState.data.p2Character : gameState.data.p1Character);
    const headline = winnerIndex === 1 ? 'PLAYER 1 WINS' : gameState.data.mode === 'cpu' ? 'CPU WINS' : 'PLAYER 2 WINS';
    // An online match cannot be replayed locally: both options that would keep
    // the current setup send the player back to the lobby to agree a new one.
    this.online = gameState.data.mode === 'online';
    this.add.text(GAME_WIDTH/2, 76, headline, { fontFamily:FONT_FAMILY, fontSize:'58px', color:winnerIndex===1?'#E9B928':'#00C8FF', stroke:'#050505', strokeThickness:9 }).setOrigin(.5);
    this.add.text(GAME_WIDTH/2, 138, winner.ultimate.name + ' ENERGY', { fontFamily:FONT_FAMILY, fontSize:'18px', color:'#F3E9D0' }).setOrigin(.5);
    const winImg = this.add.image(350, 530, poseTextureKey(winner.id,'victory')).setOrigin(.5,1);
    const loseImg = this.add.image(930, 545, poseTextureKey(loser.id,'ko')).setOrigin(.5,1).setAlpha(.78);
    this.normalize(winImg,340,450); this.normalize(loseImg,290,400);
    this.add.text(350, 565, winner.name, { fontFamily:FONT_FAMILY, fontSize:'28px', color:'#E9B928' }).setOrigin(.5);
    this.add.text(930, 565, loser.name, { fontFamily:FONT_FAMILY, fontSize:'24px', color:'#8e8e8e' }).setOrigin(.5);
    const labels = ['REMATCH','CHARACTER SELECT','MAIN MENU'];
    this.options = labels.map((label,i)=>this.add.text(GAME_WIDTH/2, 260+i*66, label, { fontFamily:FONT_FAMILY, fontSize:'26px', color:'#F3E9D0', backgroundColor:'#090909', padding:{x:22,y:9} }).setOrigin(.5));
    this.refresh(); this.inputLockedUntil = this.time.now+400; AudioManager.play('victory');
    const kb=this.input.keyboard; if(!kb)return;
    kb.on('keydown',this.onKey,this); this.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>kb.off('keydown',this.onKey,this));
  }
  private onKey(event:KeyboardEvent):void{
    if(this.time.now<this.inputLockedUntil)return; const code=event.code;
    if(code.startsWith('Arrow')||code==='Space')event.preventDefault();
    if(code==='ArrowUp'||code==='KeyW'){this.index=(this.index+2)%3;AudioManager.play('menu');this.refresh();}
    else if(code==='ArrowDown'||code==='KeyS'){this.index=(this.index+1)%3;AudioManager.play('menu');this.refresh();}
    else if(code==='Enter'||code==='KeyF'||code==='KeyJ'||code==='Space'){AudioManager.play('menu');
      gameState.resetMatch();
      if(this.online){endOnlineMatch();this.scene.start(this.index===2?'ModeSelectScene':'OnlineLobbyScene');return;}
      if(this.index===0){gameState.rollMatchSetup();this.scene.start('PrepareMatchScene', { next: 'VsScene' });}
      else if(this.index===1){this.scene.start('CharacterSelectScene');}
      else{this.scene.start('ModeSelectScene');}
    } else if(code==='KeyM') AudioManager.toggleMute();
  }
  private refresh():void{this.options.forEach((o,i)=>o.setColor(i===this.index?'#E9B928':'#F3E9D0').setScale(i===this.index?1.08:1).setText(`${i===this.index?'▶ ':''}${['REMATCH','CHARACTER SELECT','MAIN MENU'][i]}${i===this.index?' ◀':''}`));}
  private normalize(image:Phaser.GameObjects.Image,maxH:number,maxW:number):void{const s=image.texture.getSourceImage() as HTMLImageElement|HTMLCanvasElement;image.setScale(Math.min(maxH/Math.max(1,s.height),maxW/Math.max(1,s.width)));}
}
