import {FIXED_MS} from '../utils/constants';
export class CombatClock { accumulator=0;frame=0;paused=false;frozen=false;pendingStep=false;timeScale=1;
 reset(){this.accumulator=0;this.frame=0;this.paused=false;this.frozen=false;this.pendingStep=false;this.timeScale=1;}
 advance(delta:number,step:(frame:number)=>void){if(this.paused)return;this.accumulator+=Math.min(delta,100)*this.timeScale;let guard=0;while(this.accumulator>=FIXED_MS&&guard++<8){this.accumulator-=FIXED_MS;if(this.frozen&&!this.pendingStep)continue;this.pendingStep=false;this.frame++;step(this.frame);}}
 stepOnce(){this.pendingStep=true;}
}
