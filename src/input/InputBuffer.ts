import type {InputSnapshot} from './InputSnapshot';
export class InputBuffer {
  history:InputSnapshot[]=[];
  readonly max=30;
  push(s:InputSnapshot){this.history.push(s);if(this.history.length>this.max)this.history.shift();}
  clear(){this.history=[];}
  latest(){return this.history.at(-1);}
  pressed(name:keyof Omit<InputSnapshot,'frame'|'pressed'|'released'>,within=1){return this.history.slice(-within).some(s=>s.pressed.has(String(name)));}
  recent(within:number){return this.history.slice(-within);}
}
