import Phaser from 'phaser';
import type {FighterRuntime} from '../fighters/Fighter';
export class DebugOverlay {
 private text:Phaser.GameObjects.Text;visible=false;
 constructor(scene:Phaser.Scene){this.text=scene.add.text(12,125,'',{fontFamily:'monospace',fontSize:'13px',color:'#d8ffe1',backgroundColor:'#000000aa',padding:{x:8,y:6}}).setDepth(120).setVisible(false);}
 toggle(){this.visible=!this.visible;this.text.setVisible(this.visible);return this.visible;}
 update(frame:number,p1:FighterRuntime,p2:FighterRuntime,extra:string[]=[]){if(!this.visible)return;const row=(f:FighterRuntime)=>{const m=f.currentMove;const active=m?f.activeDuration():0;const phase=!m?'-':f.stateFrame<=m.startup?`STARTUP ${f.stateFrame}/${m.startup}`:f.stateFrame<=m.startup+active?`ACTIVE ${f.stateFrame-m.startup}/${active}`:`RECOVERY ${f.stateFrame-m.startup-active}/${m.recovery}`;return `${f.side===1?'P1':'P2'} ${f.state} F${f.stateFrame} MOVE:${m?.name??'-'} [${phase}] ADV:${f.frameAdvantage} HP:${f.hp.toFixed(1)} M:${f.meter.toFixed(0)} POS:${f.x.toFixed(0)},${f.y.toFixed(0)} STUN:${f.stunFrames} STOP:${f.hitstop} ARM:${f.armorHits} INV:${m?.invulnerability?.map(x=>x.kind).join('/')??'-'} CMD:${f.lastCommand||'-'} STATUS:${[...f.statuses.keys()].join(',')||'-'} ULT:${f.ultimatePhase||'-'} THREAT:${f.ultimateThreat||'-'}`};this.text.setText([`SIM FRAME ${frame}`,row(p1),row(p2),...extra].join('\n'));}
 destroy(){this.text.destroy();}
}
