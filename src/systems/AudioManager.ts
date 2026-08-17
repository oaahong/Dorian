export class AudioManager {
  private ctx?:AudioContext; muted=false;
  ensure(){if(!this.ctx)this.ctx=new AudioContext();if(this.ctx.state==='suspended')void this.ctx.resume();}
  toggle(){this.muted=!this.muted;}
  beep(type:'menu'|'light'|'heavy'|'block'|'armor'|'parry'|'jump'|'throw'|'special'|'ultimate'|'ko'|'victory'){
    if(this.muted)return;this.ensure();const c=this.ctx!;const o=c.createOscillator(),g=c.createGain();
    const map:Record<string,[number,number,string]>={menu:[520,.05,'square'],light:[180,.05,'square'],heavy:[90,.09,'sawtooth'],block:[260,.05,'triangle'],armor:[120,.08,'square'],parry:[760,.06,'sine'],jump:[360,.08,'triangle'],throw:[110,.11,'sawtooth'],special:[430,.11,'square'],ultimate:[65,.22,'sawtooth'],ko:[55,.35,'sawtooth'],victory:[660,.18,'triangle']};
    const [f,d,t]=map[type];o.type=t as OscillatorType;o.frequency.value=f;g.gain.setValueAtTime(.06,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+d);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+d);
  }
  shutdown(){/* shared context intentionally retained; no dangling nodes are kept */}
}
export const audio=new AudioManager();
