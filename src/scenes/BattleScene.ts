import * as Phaser from 'phaser';
import { Fighter } from '../fighters/Fighter';
import { getFighterConfig } from '../fighters/fighterData';
import { PlayerController } from '../controllers/PlayerController';
import { CPUController } from '../controllers/CPUController';
import type { Controller } from '../controllers/Controller';
import { EMPTY_INTENT } from '../controllers/Controller';
import { CombatSystem } from '../combat/CombatSystem';
import { VFXManager } from '../systems/VFXManager';
import { AudioManager } from '../systems/AudioManager';
import { gameState } from '../systems/GameState';
import { StageRenderer } from '../stages/StageRenderer';
import { BattleHUD } from '../ui/BattleHUD';
import { ARENA_MAX_X, ARENA_MIN_X, COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH, ROUND_TIME_MS } from '../utils/constants';

export class BattleScene extends Phaser.Scene {
  private world!: Phaser.GameObjects.Container;
  private p1!: Fighter;
  private p2!: Fighter;
  private p1Controller!: Controller;
  private p2Controller!: Controller;
  private combat!: CombatSystem;
  private vfx!: VFXManager;
  private hud!: BattleHUD;
  private roundTimeMs = ROUND_TIME_MS;
  private roundNumber = 1;
  private phase: 'intro' | 'fight' | 'ending' = 'intro';
  private hitStopMs = 0;
  private paused = false;
  private pausePanel!: Phaser.GameObjects.Container;
  private debugEnabled = false;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private debugText!: Phaser.GameObjects.Text;
  private roundToken = 0;

  constructor() { super('BattleScene'); }

  create(): void {
    this.roundTimeMs = ROUND_TIME_MS;
    this.roundNumber = 1;
    this.phase = 'intro';
    this.hitStopMs = 0;
    this.paused = false;
    this.debugEnabled = false;
    this.roundToken = 0;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.world = this.add.container(0, 0);
    StageRenderer.render(this, this.world, gameState.data.stage);

    const p1Config = getFighterConfig(gameState.data.p1Character);
    const p2Config = getFighterConfig(gameState.data.p2Character);
    this.p1 = new Fighter(this, p1Config, 1, 350, 1);
    this.p2 = new Fighter(this, p2Config, 2, 930, -1);
    this.world.add([this.p1.sprite, this.p2.sprite]);

    this.vfx = new VFXManager(this, this.world);
    this.combat = new CombatSystem(this, this.vfx, this.world, (ms) => { this.hitStopMs = Math.max(this.hitStopMs, ms); });
    this.p1Controller = new PlayerController(this, 1);
    this.p2Controller = gameState.data.mode === 'cpu'
      ? new CPUController(this.p2, this.p1, gameState.data.difficulty)
      : new PlayerController(this, 2);
    this.hud = new BattleHUD(this, this.p1, this.p2, gameState.data.mode === 'cpu' ? 'CPU' : 'P2');

    this.debugGraphics = this.add.graphics().setDepth(1400).setVisible(false);
    this.debugText = this.add.text(16, 116, '', { fontFamily:'monospace', fontSize:'14px', color:'#7CFF00', backgroundColor:'#000000aa', padding:{x:6,y:5} }).setDepth(1401).setVisible(false);
    this.createPausePanel();
    this.bindGlobalKeys();
    this.beginRound();
  }

  update(time: number, delta: number): void {
    if (this.paused) return;
    const dt = Math.min(delta, 34);

    if (this.hitStopMs > 0) {
      this.hitStopMs -= dt;
      this.hud.update(this.p1, this.p2, this.roundTimeMs, gameState.data.p1RoundWins, gameState.data.p2RoundWins);
      this.drawDebug();
      return;
    }

    if (this.phase === 'fight') {
      const p1Intent = this.p1Controller.update(time);
      const p2Intent = this.p2Controller.update(time);
      this.p1.update(dt, p1Intent, this.p2, time, true);
      this.p2.update(dt, p2Intent, this.p1, time, true);
      this.resolvePushCollision();
      this.combat.update(dt, time, this.p1, this.p2);
      this.roundTimeMs = Math.max(0, this.roundTimeMs - dt);

      if (this.p1.hp <= 0 || this.p2.hp <= 0) {
        const winner: 0 | 1 | 2 = this.p1.hp <= 0 && this.p2.hp <= 0 ? 0 : this.p1.hp <= 0 ? 2 : 1;
        this.endRound(winner, 'KO');
      } else if (this.roundTimeMs <= 0) {
        const diff = this.p1.hp - this.p2.hp;
        this.endRound(Math.abs(diff) < .01 ? 0 : diff > 0 ? 1 : 2, 'TIME');
      }
    } else {
      this.p1.update(dt, EMPTY_INTENT, this.p2, time, false);
      this.p2.update(dt, EMPTY_INTENT, this.p1, time, false);
      this.resolvePushCollision();
    }

    this.hud.update(this.p1, this.p2, this.roundTimeMs, gameState.data.p1RoundWins, gameState.data.p2RoundWins);
    this.drawDebug();
  }

  private beginRound(): void {
    this.roundToken += 1;
    const token = this.roundToken;
    this.phase = 'intro';
    this.roundTimeMs = ROUND_TIME_MS;
    this.hitStopMs = 0;
    this.combat.clear();
    this.p1Controller.reset(); this.p2Controller.reset();
    this.p1.reset(350, 1); this.p2.reset(930, -1);
    this.announce(`ROUND ${this.roundNumber}`, COLORS.cream, 58, 520);
    this.time.delayedCall(620, () => {
      if (token !== this.roundToken) return;
      this.announce('CAT FIGHT!', COLORS.red, 72, 440);
      AudioManager.play('heavy');
      this.vfx.flash(COLORS.white, .2, 70);
    });
    this.time.delayedCall(1120, () => {
      if (token !== this.roundToken) return;
      this.phase = 'fight';
    });
  }

  private endRound(winner: 0 | 1 | 2, reason: 'KO' | 'TIME'): void {
    if (this.phase !== 'fight') return;
    this.phase = 'ending';
    this.roundToken += 1;
    if (winner === 1) gameState.data.p1RoundWins += 1;
    else if (winner === 2) gameState.data.p2RoundWins += 1;

    if (reason === 'KO') {
      AudioManager.play('ko');
      this.vfx.hitSpark(winner === 1 ? this.p2.x : this.p1.x, (winner === 1 ? this.p2.y : this.p1.y) - 115, true, COLORS.red);
      this.vfx.flash(COLORS.white, .72, 110);
      this.vfx.shake(.018, 380);
      this.announce('K.O.', COLORS.red, 110, 900);
    } else this.announce(winner === 0 ? 'DRAW' : 'TIME!', winner === 0 ? COLORS.cream : COLORS.gold, 76, 850);

    if (winner === 1) {
      this.p1.forceVictory();
      if (reason === 'TIME') this.p2.forceKO();
    } else if (winner === 2) {
      this.p2.forceVictory();
      if (reason === 'TIME') this.p1.forceKO();
    }

    const matchOver = gameState.data.p1RoundWins >= 2 || gameState.data.p2RoundWins >= 2;
    this.time.delayedCall(2350, () => {
      if (matchOver) {
        gameState.data.matchWinner = gameState.data.p1RoundWins >= 2 ? 1 : 2;
        this.scene.start('ResultScene');
      } else {
        this.roundNumber += 1;
        this.beginRound();
      }
    });
  }

  private resolvePushCollision(): void {
    if (this.p1.isAirborne || this.p2.isAirborne) return;
    const dx = this.p2.x - this.p1.x;
    const minDistance = 86;
    if (Math.abs(dx) >= minDistance || Math.abs(dx) < .01) return;
    const direction = dx >= 0 ? 1 : -1;
    const overlap = minDistance - Math.abs(dx);
    this.p1.x = Phaser.Math.Clamp(this.p1.x - direction * overlap * .5, ARENA_MIN_X, ARENA_MAX_X);
    this.p2.x = Phaser.Math.Clamp(this.p2.x + direction * overlap * .5, ARENA_MIN_X, ARENA_MAX_X);
  }

  private announce(text: string, color: number, size: number, duration: number): void {
    const label = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, text, {
      fontFamily:FONT_FAMILY, fontSize:`${size}px`, color:`#${color.toString(16).padStart(6,'0')}`, stroke:'#050505', strokeThickness:12,
    }).setOrigin(.5).setDepth(1300).setScale(.4).setAlpha(0);
    this.tweens.add({ targets:label, alpha:1, scale:1, duration:110, ease:'Back.easeOut', hold:Math.max(80,duration-220), yoyo:true, onComplete:()=>label.destroy() });
  }

  private createPausePanel(): void {
    const shade = this.add.rectangle(GAME_WIDTH/2,GAME_HEIGHT/2,GAME_WIDTH,GAME_HEIGHT,0x000000,.78);
    const title = this.add.text(GAME_WIDTH/2,300,'PAUSED',{fontFamily:FONT_FAMILY,fontSize:'68px',color:'#E9B928',stroke:'#050505',strokeThickness:9}).setOrigin(.5);
    const help = this.add.text(GAME_WIDTH/2,390,'ESC  RESUME\nQ  MAIN MENU',{fontFamily:FONT_FAMILY,fontSize:'24px',color:'#F3E9D0',align:'center',lineSpacing:12}).setOrigin(.5);
    this.pausePanel=this.add.container(0,0,[shade,title,help]).setDepth(2000).setVisible(false);
  }

  private bindGlobalKeys(): void {
    const kb=this.input.keyboard; if(!kb)return;
    const handler=(event:KeyboardEvent)=>{
      const code=event.code;
      if(code==='Escape'){this.paused=!this.paused;this.pausePanel.setVisible(this.paused);AudioManager.play('menu');}
      else if(code==='KeyQ'&&this.paused){gameState.resetMatch();this.scene.start('ModeSelectScene');}
      else if(code==='F2'){event.preventDefault();this.debugEnabled=!this.debugEnabled;this.debugGraphics.setVisible(this.debugEnabled);this.debugText.setVisible(this.debugEnabled);}
      else if(code==='KeyM'){const muted=AudioManager.toggleMute();this.vfx.popup(muted?'MUTED':'SOUND ON',GAME_WIDTH/2,120,COLORS.cream,20);}
    };
    kb.on('keydown',handler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>kb.off('keydown',handler));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{this.combat.destroy();this.vfx.destroy();});
  }

  private drawDebug(): void {
    if(!this.debugEnabled)return;
    this.debugGraphics.clear();
    this.debugGraphics.lineStyle(2,0x00ff66,.9);
    [this.p1,this.p2].forEach((fighter)=>{
      const h=fighter.getHurtbox(); this.debugGraphics.strokeRect(h.x,h.y,h.width,h.height);
      if(fighter.currentAttack&&fighter.attackActive){const a=fighter.getMeleeHitbox(fighter.currentAttack.spec);this.debugGraphics.lineStyle(2,0xff3355,.9);this.debugGraphics.strokeRect(a.x,a.y,a.width,a.height);this.debugGraphics.lineStyle(2,0x00ff66,.9);}
    });
    this.debugText.setText([
      `FPS ${this.game.loop.actualFps.toFixed(1)}  PHASE ${this.phase}  STAGE ${gameState.data.stage}`,
      `P1 ${this.p1.state} HP=${this.p1.hp.toFixed(1)} E=${this.p1.memeEnergy.toFixed(0)} CD=${Math.max(0,this.p1.nextSpecialAt-this.time.now).toFixed(0)}ms`,
      `P2 ${this.p2.state} HP=${this.p2.hp.toFixed(1)} E=${this.p2.memeEnergy.toFixed(0)} CD=${Math.max(0,this.p2.nextSpecialAt-this.time.now).toFixed(0)}ms`,
    ]);
  }
}
