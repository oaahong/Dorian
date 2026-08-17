import type {Controller,FighterIntent,CombatAction} from './Controller';
import {neutralIntent} from './Controller';
import type {FighterConfig} from '../fighters/FighterConfig';
import type {FighterRuntime} from '../fighters/Fighter';
export type Difficulty='EASY'|'NORMAL'|'HARD';

export class CPUController implements Controller {
 private nextDecision=0;
 private held:FighterIntent=neutralIntent();
 constructor(private config:FighterConfig,private self:()=>FighterRuntime,private foe:()=>FighterRuntime,private difficulty:Difficulty){}
 reset(){this.nextDecision=0;this.held=neutralIntent();}
 private reactionWindow(){return this.difficulty==='EASY'?[26,34]:this.difficulty==='HARD'?[10,14]:[16,22];}
 private ultimateChance(){return this.difficulty==='EASY'?.24:this.difficulty==='HARD'?.62:.42;}
 private shouldUltimate(me:FighterRuntime,foe:FighterRuntime,dist:number,foeRecovery:boolean,foeAttacking:boolean){
  if(me.meter<100)return false;
  const projectileCommit=!!foe.currentMove&&['projectile','beam','zone','summon'].includes(foe.currentMove.kind);
  const foeCorner=Math.min(foe.x-80,1200-foe.x)<135;
  switch(this.config.id){
   case 'alien': return dist>=300&&(foeRecovery||!foeAttacking);
   case 'doge': return dist>=260&&!foeAttacking&&!me.statuses.has('install');
   case 'ya': return foeRecovery||(dist>=190&&foe.guardHeld);
   case 'tempura': return dist>=260&&(foeRecovery||!foeAttacking);
   case 'goblin': return !foe.airborne&&(foeRecovery||(foeAttacking&&dist>=170));
   case 'salad': return dist>=220&&!foe.airborne&&(foeRecovery||!foeAttacking);
   case 'wizard': return dist>=250&&(foeRecovery||!foeAttacking);
   case 'blade': return foeRecovery||(dist<=280&&!foe.airborne&&foeAttacking);
   case 'pink': return foeRecovery||(dist>=170&&dist<=350&&!foeAttacking);
   case 'sauce': return (foe.statuses.has('sticky')||foeRecovery)&&dist>=150;
   case 'scared': return foeRecovery||(dist>=300&&!foeAttacking)||(me.hp<=35&&dist>=230);
   case 'ok': return foeRecovery||foeCorner||projectileCommit;
   default:return false;
  }
 }
 tick(frame:number,_facing:1|-1):FighterIntent{
  const me=this.self(),foe=this.foe();
  if(frame<this.nextDecision)return {...this.held,action:null};
  const rw=this.reactionWindow();this.nextDecision=frame+Math.floor(rw[0]+Math.random()*(rw[1]-rw[0]+1));
  const r=this.config.designProfile.cpuRules;const dx=foe.x-me.x,dist=Math.abs(dx);let action:CombatAction=null,moveX:-1|0|1=0,guard=false,crouch=false,jump=false;
  const foeAttacking=foe.isAttackState();const foeRecovery=!!foe.currentMove&&foe.stateFrame>foe.currentMove.startup+foe.activeDuration();
  const projectileCommit=!!foe.currentMove&&['projectile','beam','zone','summon'].includes(foe.currentMove.kind);
  const corner=Math.min(me.x-80,1200-me.x);const blockChance=this.difficulty==='EASY'?.2:this.difficulty==='HARD'?.55:.4;

  if(foeAttacking&&Math.random()<blockChance){guard=true;crouch=foe.currentMove?.attackType==='Low';}
  else if(foe.airborne&&dist<175&&Math.random()<(this.difficulty==='EASY'?.15:.58)){action=this.config.functionMove.kind==='antiAir'?'function':'heavy';}
  else if(this.shouldUltimate(me,foe,dist,foeRecovery,foeAttacking)&&Math.random()<r.ultimateBias*this.ultimateChance()){action='ultimate';}
  else if(this.config.id==='scared'){
   if(projectileCommit&&dist>150&&!me.cooldowns.has('scared-box')&&Math.random()<.62)action='function';
   else if(foeRecovery&&this.config.special3&&dist<330)action='special3';
   else if(foeAttacking&&dist<150&&Math.random()<.48)action='special2';
   else if(dist<210){moveX=dx>0?-1:1;if(Math.random()<.45)action='dashBack';}
   else if(dist<390&&Math.random()<.5)action='special1';
   else moveX=dx>0?1:-1;
  }
  else if(this.config.id==='doge'){
   if(foeAttacking&&dist<175&&Math.random()<.55)action='special1';
   else if(foeRecovery&&dist<300)action='special2';
   else if(dist>300&&me.meter<75&&!me.cooldowns.has('doge-pet')&&Math.random()<.34)action='function';
   else if(dist>230)moveX=dx>0?1:-1;
   else action=Math.random()<.55?'light':'special2';
  }
  else if(this.config.id==='ya'){
   if(foeAttacking&&Math.random()<r.parryBias)action='function';
   else if(dist<150){moveX=dx>0?-1:1;if(Math.random()<.4)action='special2';}
   else if(dist<300&&Math.random()<.5)action='special1';
   else moveX=dx>0?1:-1;
  }
  else if(this.config.id==='tempura'){
   if(projectileCommit&&Math.random()<r.armorBias)action='function';
   else if(dist>320)action=Math.random()<.58?'special1':'special2';
   else if(dist<180)moveX=dx>0?-1:1;
   else action=Math.random()<.48?'special2':'heavy';
  }
  else if(this.config.id==='goblin'){
   if(dist<150)action=Math.random()<.52?'commandThrow':'special2';
   else {moveX=dx>0?1:-1;if(foeRecovery&&dist<260)action='heavy';}
  }
  else if(this.config.id==='salad'){
   if(dist>260)action=Math.random()<.6?'special1':'special2';
   else if(dist<150)action='special2';
   else moveX=dx>0?-1:1;
  }
  else if(this.config.id==='wizard'){
   if(foe.crouchHeld&&dist<220&&Math.random()<.58)action='special2';
   else if(dist>220)action=Math.random()<.66?'special1':'heavy';
   else moveX=dx>0?-1:1;
  }
  else if(this.config.id==='blade'){
   if(foeAttacking&&dist<220&&Math.random()<r.armorBias)action='special2';
   else if(foeRecovery&&dist<180)action='special1';
   else if(dist>210)moveX=dx>0?1:-1;
   else action=Math.random()<.5?'heavy':'light';
  }
  else if(this.config.id==='pink'){
   if(foeRecovery&&dist<230&&Math.random()<.6)action='special2';
   else if(dist>=150&&dist<340)action='special1';
   else if(dist>340)moveX=dx>0?1:-1;
   else action='heavy';
  }
  else if(this.config.id==='sauce'){
   if(!foe.statuses.has('sticky')&&dist>150)action='special1';
   else if(foeAttacking&&dist<170&&Math.random()<r.armorBias)action='function';
   else if(dist>200)action=Math.random()<.48?'special2':'dashForward';
   else action=Math.random()<.55?'heavy':'light';
  }
  else if(this.config.id==='alien'){
   if(foe.airborne&&dist<190)action='function';
   else if(dist>300)action=Math.random()<.68?'special1':'special2';
   else if(dist<180)moveX=dx>0?-1:1;
   else action='special1';
  }
  else if(this.config.id==='ok'){
   if(foeRecovery&&dist<300)action='special1';
   else if((foe.state==='WALK_FORWARD'||foe.state==='FORWARD_DASH')&&dist<270&&Math.random()<.5)action='function';
   else if(foe.guardHeld&&dist<330)action='special2';
   else if(dist>310)moveX=dx>0?1:-1;
   else action=Math.random()<.48?'special1':'heavy';
  }
  else if(dist<95&&Math.random()<r.throwBias){action=this.config.special1.kind==='commandThrow'?'commandThrow':'throw';}
  else if(foeRecovery&&dist<230&&Math.random()<.7){action='heavy';}
  else if(dist>r.desiredRange+70){moveX=dx>0?1:-1;if(Math.random()<r.projectileBias){action='special1';moveX=0;}}
  else if(dist<r.desiredRange-60&&Math.random()<r.retreat){moveX=dx>0?-1:1;}
  else if(Math.random()<r.aggression){action=Math.random()<.58?'light':'heavy';}
  else moveX=Math.random()<.5?(dx>0?1:-1):0;

  if(corner<75&&moveX===(me.x<640?-1:1))moveX=0;
  this.held={...neutralIntent(),moveX,crouch,jump,guard,action};return this.held;
 }
}
