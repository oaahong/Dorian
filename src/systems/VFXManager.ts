import Phaser from 'phaser';
export class VFXManager {
 constructor(private scene:Phaser.Scene){}
 spark(x:number,y:number,kind:'hit'|'heavy'|'block'|'armor'|'parry'|'perfect'='hit'){
  const colors={hit:0xffffff,heavy:0xffb21a,block:0x57b8ff,armor:0xffef67,parry:0x9affff,perfect:0xff64ff};
  const g=this.scene.add.graphics().setDepth(50);g.lineStyle(kind==='heavy'?7:4,colors[kind],1);
  for(let i=0;i<9;i++){const a=Math.PI*2*i/9,r=Phaser.Math.Between(18,44);g.lineBetween(x,y,x+Math.cos(a)*r,y+Math.sin(a)*r);}this.scene.tweens.add({targets:g,alpha:0,scale:1.8,duration:150,onComplete:()=>g.destroy()});
 }
 callout(text:string,x:number,y:number,color='#ffffff'){
  const t=this.scene.add.text(x,y,text,{fontFamily:'Impact, sans-serif',fontSize:'32px',color,stroke:'#000',strokeThickness:7}).setOrigin(.5).setDepth(80);
  this.scene.tweens.add({targets:t,y:y-36,scale:1.25,alpha:0,duration:600,ease:'Cubic.easeOut',onComplete:()=>t.destroy()});
 }
 flash(color=0xffffff,alpha=.45,duration=90){const r=this.scene.add.rectangle(640,360,1280,720,color,alpha).setDepth(90);this.scene.tweens.add({targets:r,alpha:0,duration,onComplete:()=>r.destroy()});}
 shockwave(x:number,y:number,color=0xffffff){const c=this.scene.add.circle(x,y,12).setStrokeStyle(5,color).setDepth(55);this.scene.tweens.add({targets:c,scale:9,alpha:0,duration:250,onComplete:()=>c.destroy()});}
 afterimage(sprite:Phaser.GameObjects.Image){const im=this.scene.add.image(sprite.x,sprite.y,sprite.texture.key).setOrigin(sprite.originX,sprite.originY).setFlipX(sprite.flipX).setDisplaySize(sprite.displayWidth,sprite.displayHeight).setAlpha(.3).setTint(0x7ddcff).setDepth(sprite.depth-1);this.scene.tweens.add({targets:im,alpha:0,duration:180,onComplete:()=>im.destroy()});}
 speedLines(x:number,y:number,facing:1|-1){const g=this.scene.add.graphics().setDepth(45).lineStyle(3,0xffffff,.55);for(let i=0;i<8;i++){const yy=y-90+i*22;g.lineBetween(x-facing*30,yy,x-facing*(80+i*8),yy);}this.scene.tweens.add({targets:g,alpha:0,duration:160,onComplete:()=>g.destroy()});}
 jpegBlocks(count=14){const g=this.scene.add.graphics().setDepth(58);for(let i=0;i<count;i++){g.fillStyle(i%2?0xffffff:0x777777,.12+.03*(i%3));g.fillRect(Phaser.Math.Between(20,1180),Phaser.Math.Between(90,620),Phaser.Math.Between(30,130),Phaser.Math.Between(18,75));}this.scene.tweens.add({targets:g,alpha:0,duration:280,onComplete:()=>g.destroy()});}
 sonicRings(x:number,y:number,color=0xffffff){for(let i=0;i<3;i++){const c=this.scene.add.circle(x,y,18+i*16).setStrokeStyle(4,color,.8).setDepth(54);this.scene.tweens.add({targets:c,scale:4+i*.45,alpha:0,duration:220+i*55,onComplete:()=>c.destroy()});}}
 magicZone(x:number,y:number,color=0xb158ff){const c=this.scene.add.circle(x,y,70,color,.09).setStrokeStyle(5,color,.7).setDepth(7);this.scene.tweens.add({targets:c,scale:1.25,alpha:0,duration:520,onComplete:()=>c.destroy()});}
 crtTear(y:number){const r=this.scene.add.rectangle(640,y,1280,Phaser.Math.Between(5,18),0xffffff,.22).setDepth(88);this.scene.tweens.add({targets:r,x:Phaser.Math.Between(590,690),alpha:0,duration:120,onComplete:()=>r.destroy()});}
 panicLines(x:number,y:number,color=0xffffff){const g=this.scene.add.graphics().setDepth(57).lineStyle(3,color,.7);for(let i=0;i<16;i++){const a=Math.PI*2*i/16;g.lineBetween(x+Math.cos(a)*55,y+Math.sin(a)*55,x+Math.cos(a)*180,y+Math.sin(a)*180);}this.scene.tweens.add({targets:g,alpha:0,duration:260,onComplete:()=>g.destroy()});}
 judgementGrid(color=0xc780ff){const g=this.scene.add.graphics().setDepth(62).lineStyle(3,color,.45);for(let x=80;x<=1200;x+=140)g.lineBetween(x,120,x,620);for(let y=160;y<=600;y+=110)g.lineBetween(80,y,1200,y);this.scene.tweens.add({targets:g,alpha:0,duration:520,onComplete:()=>g.destroy()});}
 projectileTrail(x:number,y:number,color:number){const c=this.scene.add.circle(x,y,5,color,.35).setDepth(16);this.scene.tweens.add({targets:c,scale:2,alpha:0,duration:140,onComplete:()=>c.destroy()});}
 throwTechBurst(x:number,y:number){this.shockwave(x,y,0xffe45c);this.callout('THROW TECH',x,y-70,'#ffe45c');}
 memeText(text:string,x:number,y:number,color='#ffffff'){this.callout(text,x,y,color);}
 cameraShake(ms=90,intensity=.006){this.scene.cameras.main.shake(ms,intensity);}
}
