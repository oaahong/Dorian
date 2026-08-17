import {InputBuffer} from './InputBuffer';
const dirNum=(s:{up:boolean;down:boolean;left:boolean;right:boolean},facing:1|-1)=>{
  const f=facing===1?s.right:s.left; const b=facing===1?s.left:s.right;
  if(s.down&&f)return 3;if(s.down&&b)return 1;if(s.up&&f)return 9;if(s.up&&b)return 7;
  if(s.down)return 2;if(s.up)return 8;if(f)return 6;if(b)return 4;return 5;
};
export class CommandParser {
  static command(buffer:InputBuffer,seq:number[],facing:1|-1,leniency=8){
    const frames=buffer.recent(leniency).map(s=>dirNum(s,facing));
    let j=seq.length-1;
    for(let i=frames.length-1;i>=0&&j>=0;i--){if(frames[i]===seq[j])j--;}
    return j<0;
  }
  static doubleTap(buffer:InputBuffer,dir:6|4,facing:1|-1){
    const frames=buffer.recent(8).map(s=>dirNum(s,facing));
    let taps=0,was=false;
    for(const d of frames){const now=d===dir;if(now&&!was)taps++;was=now;}
    return taps>=2;
  }
}
