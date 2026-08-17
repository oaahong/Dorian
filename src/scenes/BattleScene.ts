import Phaser from 'phaser';
import {CombatClock} from '../combat/CombatClock';
import {CombatSystem,MEME_PARRY_MOVE,MEME_RUSH_MOVE} from '../combat/CombatSystem';
import {COMMON_MOVES} from '../data/commonMoves';
import {FIGHTER_BY_ID} from '../data/fighterData';
import {FighterRuntime} from '../fighters/Fighter';
import {FighterState} from '../fighters/FighterState';
import type {MoveData,UltimateMoveData} from '../combat/MoveData';
import type {Controller,FighterIntent,CombatAction} from '../controllers/Controller';
import {neutralIntent} from '../controllers/Controller';
import {PlayerController} from '../controllers/PlayerController';
import {CPUController,type Difficulty} from '../controllers/CPUController';
import type {MatchSetup} from '../systems/GameState';
import {StageRenderer,type StageId} from '../stages/StageRenderer';
import {VFXManager} from '../systems/VFXManager';
import {BattleHUD} from '../ui/BattleHUD';
import {DebugOverlay} from '../ui/DebugOverlay';
import {audio} from '../systems/AudioManager';
import {ChargeableSpecialH} from '../combat/ChargeableSpecialH';
import {UltimateInputState} from '../combat/UltimateInputState';
import {UltimateCutInManager} from '../combat/UltimateCutInManager';
import {ULTIMATE_DEFINITIONS} from '../data/ultimateDefinitions';

interface Pending {action:CombatAction;ttl:number;intent:FighterIntent;}
const ACTION_BUFFER_FRAMES=4;

export class BattleScene extends Phaser.Scene {
 protected forceTraining=false;
 private setup!:MatchSetup; private p1!:FighterRuntime; private p2!:FighterRuntime; private c1!:Controller; private c2!:Controller;
 private clock=new CombatClock(); private combat!:CombatSystem; private vfx!:VFXManager; private hud!:BattleHUD; private debug!:DebugOverlay; private cutIn!:UltimateCutInManager;
 private hCharge=new ChargeableSpecialH(); private ult1=new UltimateInputState(); private ult2=new UltimateInputState();
 private pending1:Pending|null=null;private pending2:Pending|null=null;private roundWins:[number,number]=[0,0];private roundNo=1;private timerFrames=3600;private openingFrames=66;private phase:'opening'|'fight'|'roundEnd'='opening';private roundEndFrames=0;private roundWinner:0|1|2=0;private banner!:Phaser.GameObjects.Text;private dummyGuard:0|1|2=0;private instanceCounter=0;
 constructor(key='BattleScene',forceTraining=false){super(key);this.forceTraining=forceTraining;}
 init(data:{setup?:MatchSetup}){this.setup=data.setup??this.registry.get('matchSetup');if(this.forceTraining)this.setup={...this.setup,mode:'training'};}
 create(){
  const stages:StageId[]=['freezer','magicForest','diningTable'];StageRenderer.draw(this,this.setup.stage??stages[Phaser.Math.Between(0,2)]);
  this.vfx=new VFXManager(this);this.p1=new FighterRuntime(this,FIGHTER_BY_ID[this.setup.p1],1,350);this.p2=new FighterRuntime(this,FIGHTER_BY_ID[this.setup.p2],2,930);this.p1.facing=1;this.p2.facing=-1;
  this.combat=new CombatSystem(this,this.vfx);this.cutIn=new UltimateCutInManager(this);this.hud=new BattleHUD(this,this.p1,this.p2);this.debug=new DebugOverlay(this);this.banner=this.add.text(640,280,'',{fontFamily:'Impact, sans-serif',fontSize:'78px',color:'#ffffff',stroke:'#000000',strokeThickness:10}).setOrigin(.5).setDepth(110);
  this.c1=new PlayerController(this,1);if(this.setup.mode==='local')this.c2=new PlayerController(this,2);else if(this.setup.mode==='cpu')this.c2=new CPUController(this.p2.config,()=>this.p2,()=>this.p1,this.setup.difficulty as Difficulty);else this.c2={reset:()=>{},tick:()=>({...neutralIntent(),moveX:0,crouch:this.dummyGuard===2,guard:this.dummyGuard>0})};
  this.installHotkeys();this.resetRound(false);this.events.once('shutdown',()=>this.cleanup());
 }
 update(_time:number,delta:number){if(!this.cutIn?.isActive)this.clock.advance(delta,(frame)=>this.combatStep(frame));this.p1.syncVisual();this.p2.syncVisual();this.hud.update(this.timerFrames,this.roundWins[0],this.roundWins[1]);const dbgExtra=this.forceTraining?[`TRAINING ${this.clock.frozen?'FROZEN':'RUN'} | F3 freeze | F4 +1F | F5 reset | F6 guard: ${['OFF','STAND','CROUCH'][this.dummyGuard]}`,`P1 H ${this.hCharge.debug(this.p1)} | ULT ${this.ult1.state}`,`P2 H ${this.hCharge.debug(this.p2)} | ULT ${this.ult2.state}`,`P1 INPUT ${(this.c1 instanceof PlayerController)?this.c1.debugHistory():'-'}`,`P2 INPUT ${(this.c2 instanceof PlayerController)?this.c2.debugHistory():'-'}`]:[];this.debug.update(this.clock.frame,this.p1,this.p2,dbgExtra);}
 private installHotkeys(){const kb=this.input.keyboard!;kb.on('keydown-F2',()=>{const on=this.debug.toggle();this.combat.debug=on});kb.on('keydown-ESC',()=>{this.clock.paused=!this.clock.paused;this.banner.setText(this.clock.paused?'PAUSED':'').setVisible(this.clock.paused)});kb.on('keydown-M',()=>{audio.toggle();this.vfx.callout(audio.muted?'MUTED':'SOUND ON',640,180,'#ffffff')});if(this.forceTraining){kb.on('keydown-F3',()=>{this.clock.frozen=!this.clock.frozen});kb.on('keydown-F4',()=>this.clock.stepOnce());kb.on('keydown-F5',()=>this.resetRound(true));kb.on('keydown-F6',()=>{this.dummyGuard=((this.dummyGuard+1)%3) as 0|1|2});}this.events.once('shutdown',()=>kb.removeAllListeners());}
 private combatStep(frame:number){
  if(this.phase==='roundEnd'){this.roundEndFrames++;if(this.roundEndFrames===30)this.clock.timeScale=1;if(this.roundEndFrames===28&&this.roundWinner){const w=this.roundWinner===1?this.p1:this.p2;if(w.hp>0)w.enterState(FighterState.VICTORY);}if(this.roundEndFrames>=92){if(this.forceTraining){this.resetRound(true);return;}if(this.roundWins[0]>=2||this.roundWins[1]>=2||(this.roundNo>=3&&this.roundWinner===0)){this.finishMatch();return;}this.roundNo++;this.resetRound(false);}this.p1.syncVisual();this.p2.syncVisual();return;}
  this.p1.tickExisting();this.p2.tickExisting();this.updateFacing();
  const i1=this.c1.tick(frame,this.p1.facing,this.p1.airborne);const i2=this.c2.tick(frame,this.p2.facing,this.p2.airborne);this.p1.guardHeld=i1.guard;this.p1.crouchHeld=i1.crouch;this.p2.guardHeld=i2.guard;this.p2.crouchHeld=i2.crouch;
  if(this.c1 instanceof PlayerController&&this.ult1.tick(this.p1,i1))i1.action='ultimate';
  if(this.c2 instanceof PlayerController&&this.ult2.tick(this.p2,i2))i2.action='ultimate';
  this.hCharge.tick(this.p1,i1,(move)=>this.start(this.p1,move,FighterState.H_SPECIAL,this.newInstance()));
  this.hCharge.tick(this.p2,i2,(move)=>this.start(this.p2,move,FighterState.H_SPECIAL,this.newInstance()));
  if(this.hCharge.isCharging(this.p1))i1.action=null;if(this.hCharge.isCharging(this.p2))i2.action=null;
  if(i1.action==='throw'||i1.action==='commandThrow')this.p1.lastThrowInputFrame=frame;if(i2.action==='throw'||i2.action==='commandThrow')this.p2.lastThrowInputFrame=frame;
  this.pending1=this.refreshPending(this.pending1,i1);this.pending2=this.refreshPending(this.pending2,i2);
  if(this.phase==='opening'){this.openingFrames--;this.banner.setVisible(true).setText(this.openingFrames>30?`ROUND ${this.roundNo}`:'MEME FIGHT!');this.processPending(this.p1,this.pending1,true);this.processPending(this.p2,this.pending2,true);if(this.openingFrames<=0){this.phase='fight';this.banner.setVisible(false);}this.syncUltimateMeters(i1,i2);return;}
  if(!this.forceTraining)this.timerFrames=Math.max(0,this.timerFrames-1);
  this.pending1=this.processPending(this.p1,this.pending1,false);this.pending2=this.processPending(this.p2,this.pending2,false);
  this.p1.applyIntent(i1,()=>this.newInstance(),false);this.p2.applyIntent(i2,()=>this.newInstance(),false);
  this.combat.tick(this.p1,this.p2,frame);
  if(this.forceTraining){this.p1.hp=100;this.p2.hp=100;this.p1.meter=100;this.p2.meter=100;}
  this.syncUltimateMeters(i1,i2);
  if(this.ult1.state==='ULTIMATE_GAMEPLAY'&&!this.combat.hasUltimate(this.p1))this.ult1.reset();
  if(this.ult2.state==='ULTIMATE_GAMEPLAY'&&!this.combat.hasUltimate(this.p2))this.ult2.reset();
  if(!this.forceTraining&&(this.p1.hp<=0||this.p2.hp<=0||this.timerFrames<=0))this.beginRoundEnd();
 }
 private syncUltimateMeters(i1:FighterIntent,i2:FighterIntent){if(this.c1 instanceof PlayerController)this.ult1.syncAfterExternalMeterChange(this.p1,i1.ultimateHeld);if(this.c2 instanceof PlayerController)this.ult2.syncAfterExternalMeterChange(this.p2,i2.ultimateHeld);}
 private refreshPending(old:Pending|null,intent:FighterIntent){if(intent.action)return {action:intent.action,ttl:intent.action==='specialH'?1:ACTION_BUFFER_FRAMES+1,intent:{...intent}};if(!old)return null;if(old.action==='specialH')return null;old.ttl--;return old.ttl>0?old:null;}
 private processPending(f:FighterRuntime,p:Pending|null,locked:boolean):Pending|null{if(!p)return null;if(locked)return p;if(this.tryCancel(f,p.action,p.intent))return null;const can=f.canAct()||(f.airborne&&!f.currentMove&&f.state===FighterState.JUMP);if(!can)return p;if(this.executeAction(f,p.action,p.intent))return null;return null;}
 private tryCancel(f:FighterRuntime,action:CombatAction,intent:FighterIntent){if(!f.currentMove)return false;const m=f.currentMove;
  if(action==='rush'&&['hit','block'].includes(f.moveResult)){const normal=['standingLight','standingHeavy','crouchingLight','crouchingHeavy'].includes(m.id);if(normal&&f.spendMeter(20)){f.currentMove=null;return this.start(f,{...MEME_RUSH_MOVE,pose:f.config.id==='alien'?5:6},FighterState.MEME_RUSH,this.newInstance());}}
  if(action&&['special1','special2','special3','function'].includes(action)){const rule=m.cancelRules?.find(r=>r.into==='special'&&(r.condition==='always'||r.condition==='onHitOrBlock'&&['hit','block'].includes(f.moveResult)||r.condition==='onHit'&&f.moveResult==='hit'||r.condition==='onBlock'&&f.moveResult==='block'));if(rule){f.currentMove=null;return this.executeAction(f,action,intent);}}
  if(action==='ultimate'&&f.moveResult==='hit'&&!['standingLight','standingHeavy','crouchingLight','crouchingHeavy','jumpLight','jumpHeavy'].includes(m.id)&&f.meter>=100){f.currentMove=null;return this.executeAction(f,'ultimate',intent);}return false;
 }
 private start(f:FighterRuntime,m:MoveData,state:FighterState,id:string){const reversal=f.wakeupReversalFrames>0;const ok=f.startMove(m,state,id);if(ok&&reversal){f.wakeupReversalFrames=0;this.vfx.callout('REVERSAL',f.x,f.y-235,'#ff9f5a');}return ok;}
 private normal(f:FighterRuntime,key:keyof typeof COMMON_MOVES,pose:number){const base=COMMON_MOVES[key];return {...base,pose:f.config.id==='alien'?pose+2:pose};}
 private executeAction(f:FighterRuntime,action:CombatAction,intent:FighterIntent){if(!action)return false;const id=this.newInstance();
  if(action==='dashForward')return f.startDash(true);if(action==='dashBack')return f.startDash(false);
  if(action==='light'){let m=f.airborne?this.normal(f,'jumpLight',12):intent.crouch?this.normal(f,'crouchingLight',10):this.normal(f,'standingLight',8);if(!f.airborne&&!intent.crouch&&f.installType==='DUAL_HEAVY')m={...m,id:'blade-install-f',name:'Install Wide Horizontal Slash',startup:7,active:4,recovery:18,damage:11,hitstun:18,blockstun:14,pushbackX:72,range:185,hitstopAttacker:5,hitstopVictim:8};else if(!f.airborne&&!intent.crouch&&f.installType==='REAL_FACE')m={...m,id:'pink-real-slap',name:'Fast Real-Face Slap',startup:3,active:3,recovery:10,damage:7,hitstun:13,blockstun:8,pushbackX:30,range:122};const st=f.airborne?FighterState.JUMP_LIGHT:intent.crouch?FighterState.CROUCHING_LIGHT:FighterState.STANDING_LIGHT;return this.start(f,m,st,id);}
  if(action==='heavy'){let m=f.airborne?this.normal(f,'jumpHeavy',13):intent.crouch?this.normal(f,'crouchingHeavy',11):this.normal(f,'standingHeavy',9);if(!f.airborne&&!intent.crouch&&f.installType==='DUAL_HEAVY')m={...m,id:'blade-install-g',name:'Install Heavy Downward Slash',startup:13,active:5,recovery:28,damage:15,hitstun:22,blockstun:18,pushbackX:112,range:198,hitstopAttacker:7,hitstopVictim:10,hardKnockdown:true};else if(!f.airborne&&!intent.crouch&&f.installType==='REAL_FACE')m={...m,id:'pink-real-belly',name:'Heavy Belly Bump',startup:8,active:4,recovery:19,damage:10,hitstun:18,blockstun:11,pushbackX:82,range:158,hitstopVictim:8};const st=f.airborne?FighterState.JUMP_HEAVY:intent.crouch?FighterState.CROUCHING_HEAVY:FighterState.STANDING_HEAVY;return this.start(f,m,st,id);}
  if(action==='throw'){if(f.airborne)return false;return this.start(f,{...COMMON_MOVES.throw,pose:f.config.id==='alien'?22:18},FighterState.THROW,id);}
  if(action==='commandThrow'){if(f.airborne)return false;if(f.config.special1.kind==='commandThrow')return this.start(f,f.config.special1,FighterState.SPECIAL_1,id);return this.start(f,{...COMMON_MOVES.throw,pose:f.config.id==='alien'?22:18},FighterState.THROW,id);}
  if(action==='specialH')return intent.specialHeld?this.hCharge.begin(f):false;
  if(action==='special1')return this.start(f,f.config.special1,FighterState.SPECIAL_1,id);if(action==='special2')return this.start(f,f.config.special2,FighterState.SPECIAL_2,id);if(action==='special3'){if(!f.config.special3)return false;return this.start(f,f.config.special3,FighterState.SPECIAL_3,id);}if(action==='function')return this.start(f,f.config.functionMove,FighterState.FUNCTION_MOVE,id);
  if(action==='impact'){if(!f.spendMeter(25)){this.vfx.callout('NOT ENOUGH MEME',f.x,f.y-230,'#ff7a7a');return false;}return this.start(f,{...COMMON_MOVES.memeImpact,pose:f.config.id==='alien'?11:9},FighterState.MEME_IMPACT,id);}if(action==='parry'){if(f.cooldowns.has('meme-parry'))return false;return this.start(f,{...MEME_PARRY_MOVE,pose:f.config.id==='alien'?8:14},FighterState.MEME_PARRY,id);}if(action==='rush')return this.start(f,{...MEME_RUSH_MOVE,pose:f.config.id==='alien'?5:6},FighterState.MEME_RUSH,id);
  if(action==='ultimate')return this.startUltimate(f,intent,id);return false;
 }
 private startUltimate(f:FighterRuntime,_intent:FighterIntent,id:string){if(f.meter<100){this.vfx.callout('NOT ENOUGH MEME',f.x,f.y-230,'#ff7a7a');return false;}if(this.cutIn.isActive||this.combat.hasUltimate(f))return false;const m=f.config.ultimate as UltimateMoveData;const foe=f===this.p1?this.p2:this.p1;if(!this.start(f,m,FighterState.ULTIMATE,id))return false;if(!f.spendMeter(100)){f.currentMove=null;f.enterState(FighterState.IDLE);return false;}const def=ULTIMATE_DEFINITIONS[f.config.id];const gate=f===this.p1?this.ult1:this.ult2;if((f===this.p1&&this.c1 instanceof PlayerController)||(f===this.p2&&this.c2 instanceof PlayerController))gate.setRuntime('ULTIMATE_CUTIN');f.statuses.set('ultimateCutIn',999);
  const started=this.cutIn.start(f,def,()=>{f.statuses.delete('ultimateCutIn');if(this.phase==='roundEnd'||f.hp<=0){f.currentMove=null;f.enterState(FighterState.IDLE);if((f===this.p1&&this.c1 instanceof PlayerController)||(f===this.p2&&this.c2 instanceof PlayerController))gate.reset();return;}if((f===this.p1&&this.c1 instanceof PlayerController)||(f===this.p2&&this.c2 instanceof PlayerController))gate.setRuntime('ULTIMATE_GAMEPLAY');this.combat.startUltimate(f,m,foe);});
  if(!started){f.statuses.delete('ultimateCutIn');f.gainMeter(100);f.currentMove=null;f.enterState(FighterState.IDLE);gate.reset();return false;}return true;
 }
 private updateFacing(){if(this.p1.x<this.p2.x){this.p1.facing=1;this.p2.facing=-1}else{this.p1.facing=-1;this.p2.facing=1}}
 private abortTemporaryCombat(){this.cutIn?.abort();this.combat?.clear();this.hCharge.reset();this.ult1.reset();this.ult2.reset();this.p1?.statuses.delete('ultimateCutIn');this.p2?.statuses.delete('ultimateCutIn');this.p1?.exitInstall();this.p2?.exitInstall();}
 private beginRoundEnd(){if(this.phase==='roundEnd')return;this.phase='roundEnd';this.abortTemporaryCombat();this.roundEndFrames=0;let winner:0|1|2=0;if(this.p1.hp<=0&&this.p2.hp<=0)winner=0;else if(this.p1.hp<=0)winner=2;else if(this.p2.hp<=0)winner=1;else if(this.p1.hp>this.p2.hp)winner=1;else if(this.p2.hp>this.p1.hp)winner=2;this.roundWinner=winner;if(winner===1)this.roundWins[0]++;if(winner===2)this.roundWins[1]++;this.banner.setVisible(true).setText(this.p1.hp<=0||this.p2.hp<=0?'K.O.':winner?'TIME OVER':'DRAW');this.p1.hitstop=Math.max(this.p1.hitstop,8);this.p2.hitstop=Math.max(this.p2.hitstop,8);if(this.p1.hp<=0||this.p2.hp<=0)this.clock.timeScale=.35;audio.beep('ko');}
 private resetRound(training:boolean){this.clock.timeScale=1;this.abortTemporaryCombat();this.p1.reset(350);this.p2.reset(930);this.c1.reset();this.c2.reset();this.pending1=this.pending2=null;this.timerFrames=3600;this.openingFrames=training?0:66;this.phase=training?'fight':'opening';this.banner.setVisible(!training);if(training){this.p1.meter=this.p2.meter=100;this.ult1.syncAfterExternalMeterChange(this.p1,false);this.ult2.syncAfterExternalMeterChange(this.p2,false);this.banner.setText('')}else this.banner.setText(`ROUND ${this.roundNo}`);}
 private finishMatch(){this.abortTemporaryCombat();const winner:0|1|2=this.roundWins[0]===this.roundWins[1]?0:this.roundWins[0]>this.roundWins[1]?1:2;this.registry.set('matchResult',{winner,setup:this.setup,wins:[...this.roundWins]});this.scene.start('ResultScene');}
 private newInstance(){return `a${++this.instanceCounter}-${this.clock.frame}`;}
 private cleanup(){this.abortTemporaryCombat();this.hud?.destroy();this.debug?.destroy();this.p1?.destroy();this.p2?.destroy();this.combat?.destroy();}
}
