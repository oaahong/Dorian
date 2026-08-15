import * as Phaser from 'phaser';
import type { FighterConfig } from './FighterConfig';
import { FighterState } from './FighterState';
import type { AttackSpec } from '../combat/AttackSpec';
import { HEAVY_ATTACK, LIGHT_ATTACK } from '../combat/AttackSpec';
import type { FighterIntent } from '../controllers/Controller';
import { ARENA_MAX_X, ARENA_MIN_X, CONTROL_RECOVERY_MULTIPLIER, FIGHTER_HURTBOX_HEIGHT, FIGHTER_HURTBOX_WIDTH, GRAVITY, GROUND_Y, JUMP_VELOCITY, SPEED_BY_STAT } from '../utils/constants';
import { SpriteExtractor, type PoseName } from '../systems/SpriteExtractor';
import { AudioManager } from '../systems/AudioManager';

export interface AttackRuntime {
  instanceId: number;
  spec: AttackSpec;
  elapsedMs: number;
  activeJustStarted: boolean;
  spawnedEffect: boolean;
  crouching: boolean;
  airborne: boolean;
  hitTargets: Set<Fighter>;
}

let globalAttackId = 1;

export class Fighter {
  readonly sprite: Phaser.GameObjects.Image;
  readonly config: FighterConfig;
  readonly playerIndex: 1 | 2;
  state = FighterState.IDLE;
  hp = 100;
  memeEnergy = 0;
  x: number;
  y = GROUND_Y;
  vx = 0;
  vy = 0;
  facing: 1 | -1;
  currentAttack: AttackRuntime | null = null;
  nextSpecialAt = 0;
  fullStunLockoutUntil = 0;
  debug = false;
  guardHeld = false;
  private stateRemainingMs = 0;
  private currentPose: PoseName = 'idle';
  private baseScale = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    config: FighterConfig,
    playerIndex: 1 | 2,
    x: number,
    facing: 1 | -1,
  ) {
    this.config = config;
    this.playerIndex = playerIndex;
    this.x = x;
    this.facing = facing;
    this.sprite = scene.add.image(x, GROUND_Y, SpriteExtractor.textureKey(config.id, 'idle')).setOrigin(.5, 1);
    this.normalizeVisual('idle');
  }

  get isAirborne(): boolean { return this.y < GROUND_Y - 1; }
  get isKO(): boolean { return this.state === FighterState.KO; }
  get canBlockImpact(): boolean {
    if (this.state === FighterState.BLOCK || this.state === FighterState.BLOCKSTUN) return true;
    return this.guardHeld && !this.isAirborne && !this.isAttacking && ![FighterState.HITSTUN, FighterState.KO, FighterState.VICTORY].includes(this.state);
  }
  get isAttacking(): boolean {
    return [FighterState.LIGHT_ATTACK, FighterState.HEAVY_ATTACK, FighterState.SPECIAL, FighterState.ULTIMATE].includes(this.state);
  }
  get attackActive(): boolean {
    if (!this.currentAttack) return false;
    const { spec, elapsedMs } = this.currentAttack;
    return elapsedMs >= spec.startupMs && elapsedMs < spec.startupMs + spec.activeMs;
  }

  reset(x: number, facing: 1 | -1): void {
    this.hp = 100;
    this.memeEnergy = 0;
    this.x = x;
    this.y = GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.state = FighterState.IDLE;
    this.stateRemainingMs = 0;
    this.currentAttack = null;
    this.nextSpecialAt = 0;
    this.fullStunLockoutUntil = 0;
    this.guardHeld = false;
    this.sprite.setVisible(true).setAlpha(1).clearTint().setRotation(0);
    this.setPose('idle');
    this.syncVisual();
  }

  update(deltaMs: number, intent: FighterIntent, opponent: Fighter, nowMs: number, inputEnabled: boolean): void {
    const wasGrounded = !this.isAirborne;
    this.updateFacing(opponent);
    const away = opponent.x > this.x ? -1 : 1;
    this.guardHeld = inputEnabled && intent.move === away && !intent.crouch;

    if (this.currentAttack) {
      this.currentAttack.activeJustStarted = false;
      const previous = this.currentAttack.elapsedMs;
      this.currentAttack.elapsedMs += deltaMs;
      if (previous < this.currentAttack.spec.startupMs && this.currentAttack.elapsedMs >= this.currentAttack.spec.startupMs) {
        this.currentAttack.activeJustStarted = true;
      }
      this.updateAttackMotion(deltaMs);
      const total = this.currentAttack.spec.startupMs + this.currentAttack.spec.activeMs + this.scaledRecovery(this.currentAttack.spec.recoveryMs);
      if (this.currentAttack.elapsedMs >= total && this.state !== FighterState.KO) {
        this.currentAttack = null;
        this.state = this.isAirborne ? FighterState.JUMP : FighterState.IDLE;
      }
    } else if (this.state === FighterState.HITSTUN || this.state === FighterState.BLOCKSTUN) {
      this.stateRemainingMs -= deltaMs;
      if (this.stateRemainingMs <= 0) this.state = this.isAirborne ? FighterState.JUMP : FighterState.IDLE;
    } else if (this.state === FighterState.KO || this.state === FighterState.VICTORY) {
      // Round-end states intentionally ignore input.
    } else if (inputEnabled) {
      this.processIntent(intent, opponent, nowMs);
    } else {
      this.vx = 0;
      if (!this.isAirborne && this.state !== FighterState.CROUCH) this.state = FighterState.IDLE;
    }

    this.applyPhysics(deltaMs);
    const grounded = !this.isAirborne;
    if (!wasGrounded && grounded && !this.isKO) {
      this.sprite.setScale(this.sprite.scaleX, this.sprite.scaleY * .90);
      this.scene.tweens.add({ targets: this.sprite, scaleY: Math.abs(this.sprite.scaleX), duration: 90, ease: 'Back.easeOut' });
    }
    this.updatePose();
    this.syncVisual();
  }

  receiveImpact(damage: number, spec: AttackSpec, attackerFacing: 1 | -1, blocked: boolean, nowMs: number): void {
    if (this.isKO) return;
    this.hp = Phaser.Math.Clamp(this.hp - damage, 0, 100);
    const forceScale = blocked ? .24 : 1;
    this.vx = attackerFacing * spec.knockbackX * forceScale;
    if (!blocked) this.vy = spec.knockbackY;

    if (this.hp <= 0) {
      this.state = FighterState.KO;
      this.currentAttack = null;
      this.stateRemainingMs = 0;
      this.vx = attackerFacing * Math.max(420, spec.knockbackX * 1.55);
      this.vy = Math.min(-260, spec.knockbackY * 1.5);
      this.setPose('ko');
      return;
    }

    if (blocked) {
      this.state = FighterState.BLOCKSTUN;
      this.stateRemainingMs = spec.blockstunMs;
      this.currentAttack = null;
      this.setPose('block');
    } else {
      this.state = FighterState.HITSTUN;
      let hitstun = spec.hitstunMs;
      if (spec.kind === 'aura') {
        if (nowMs < this.fullStunLockoutUntil) hitstun = Math.min(180, hitstun);
        else this.fullStunLockoutUntil = nowMs + (spec.stunLockoutMs ?? 2800);
      }
      this.stateRemainingMs = hitstun;
      this.currentAttack = null;
      this.setPose('hit');
    }
  }

  addEnergy(amount: number): void {
    this.memeEnergy = Phaser.Math.Clamp(this.memeEnergy + amount, 0, 100);
  }

  canUseSpecial(nowMs: number): boolean {
    return nowMs >= this.nextSpecialAt && !this.isKO && !this.isAttacking && ![FighterState.HITSTUN, FighterState.BLOCKSTUN].includes(this.state);
  }

  forceVictory(): void {
    this.state = FighterState.VICTORY;
    this.currentAttack = null;
    this.vx = 0;
    this.vy = 0;
    this.y = GROUND_Y;
    this.setPose('victory');
  }

  forceKO(): void {
    this.state = FighterState.KO;
    this.currentAttack = null;
    this.vx = 0;
    this.vy = 0;
    this.y = GROUND_Y;
    this.setPose('ko');
  }

  getHurtbox(): Phaser.Geom.Rectangle {
    const crouching = this.state === FighterState.CROUCH || (this.currentAttack?.crouching ?? false);
    const height = crouching ? FIGHTER_HURTBOX_HEIGHT * .66 : FIGHTER_HURTBOX_HEIGHT;
    return new Phaser.Geom.Rectangle(this.x - FIGHTER_HURTBOX_WIDTH / 2, this.y - height, FIGHTER_HURTBOX_WIDTH, height);
  }

  getMeleeHitbox(spec: AttackSpec): Phaser.Geom.Rectangle {
    const rangeScale = .88 + this.config.rangeStat * .055;
    const reach = spec.reach * rangeScale;
    const crouching = this.currentAttack?.crouching ?? false;
    const height = crouching ? 70 : 100;
    const centerY = this.y - (crouching ? 58 : this.currentAttack?.airborne ? 100 : 108);
    const x = this.facing > 0 ? this.x + 34 : this.x - 34 - reach;
    return new Phaser.Geom.Rectangle(x, centerY - height / 2, reach, height);
  }

  private processIntent(intent: FighterIntent, opponent: Fighter, nowMs: number): void {
    if (this.isAirborne) {
      if (intent.lightPressed) this.startAttack(LIGHT_ATTACK, FighterState.LIGHT_ATTACK, false, true);
      else if (intent.heavyPressed) this.startAttack(HEAVY_ATTACK, FighterState.HEAVY_ATTACK, false, true);
      if (!this.currentAttack) {
        this.vx = intent.move * SPEED_BY_STAT[this.config.speedStat]! * .75;
        this.state = FighterState.JUMP;
      }
      return;
    }

    const away = opponent.x > this.x ? -1 : 1;
    const shouldBlock = intent.move === away && !intent.crouch && Math.abs(opponent.x - this.x) < 340;
    if (shouldBlock) {
      this.state = FighterState.BLOCK;
      this.vx = 0;
      return;
    }

    if (intent.ultimatePressed) {
      if (this.memeEnergy >= 100 && this.canUseSpecial(nowMs)) {
        this.memeEnergy = 0;
        this.startAttack(this.config.ultimate, FighterState.ULTIMATE, intent.crouch, false);
        AudioManager.play('ultimate');
        return;
      }
      if (this.canUseSpecial(nowMs)) this.startSpecial(nowMs, intent.crouch);
      return;
    }
    if (intent.specialPressed && this.canUseSpecial(nowMs)) {
      this.startSpecial(nowMs, intent.crouch);
      return;
    }
    if (intent.lightPressed) {
      this.startAttack(LIGHT_ATTACK, FighterState.LIGHT_ATTACK, intent.crouch, false);
      return;
    }
    if (intent.heavyPressed) {
      this.startAttack(HEAVY_ATTACK, FighterState.HEAVY_ATTACK, intent.crouch, false);
      return;
    }
    if (intent.jumpPressed) {
      this.vy = JUMP_VELOCITY;
      this.state = FighterState.JUMP;
      AudioManager.play('jump');
      return;
    }
    if (intent.crouch) {
      this.vx = 0;
      this.state = FighterState.CROUCH;
      return;
    }
    if (intent.move !== 0) {
      this.vx = intent.move * SPEED_BY_STAT[this.config.speedStat]!;
      this.state = FighterState.WALK;
      return;
    }
    this.vx = 0;
    this.state = FighterState.IDLE;
  }

  private startSpecial(nowMs: number, crouching: boolean): void {
    const controlCooldownScale = 1.08 - this.config.controlStat * 0.025;
    this.nextSpecialAt = nowMs + (this.config.special.cooldownMs ?? 1500) * controlCooldownScale;
    this.startAttack(this.config.special, FighterState.SPECIAL, crouching, false);
    AudioManager.play('special');
  }

  private startAttack(spec: AttackSpec, state: FighterState, crouching: boolean, airborne: boolean): void {
    this.state = state;
    this.vx = airborne ? this.vx : 0;
    this.currentAttack = {
      instanceId: globalAttackId++, spec, elapsedMs: 0, activeJustStarted: false, spawnedEffect: false,
      crouching, airborne, hitTargets: new Set<Fighter>(),
    };
    const pose = state === FighterState.LIGHT_ATTACK ? 'light' : state === FighterState.HEAVY_ATTACK ? 'heavy' : state === FighterState.ULTIMATE ? 'ultimate' : 'special';
    this.setPose(pose);
    const anticipation = state === FighterState.HEAVY_ATTACK ? .92 : .96;
    this.sprite.setScale(this.sprite.scaleX * anticipation, this.sprite.scaleY * 1.04);
  }

  private updateAttackMotion(deltaMs: number): void {
    if (!this.currentAttack || !this.attackActive) return;
    const spec = this.currentAttack.spec;
    if (spec.kind === 'dash' || spec.kind === 'slide') {
      const speed = spec.kind === 'slide' ? 670 : 590;
      this.x += this.facing * speed * (deltaMs / 1000);
    } else if (spec.id === 'heavy') {
      this.x += this.facing * 105 * (deltaMs / 1000);
    }
  }

  private applyPhysics(deltaMs: number): void {
    const dt = deltaMs / 1000;
    if (this.isAirborne || this.vy < 0) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      this.x += this.vx * dt;
      if (this.y >= GROUND_Y) {
        this.y = GROUND_Y;
        this.vy = 0;
        if (this.state === FighterState.JUMP) this.state = FighterState.IDLE;
      }
    } else if (!this.currentAttack || !['dash','slide'].includes(this.currentAttack.spec.kind)) {
      this.x += this.vx * dt;
    }
    if (this.state === FighterState.HITSTUN || this.state === FighterState.BLOCKSTUN || this.state === FighterState.KO) {
      this.vx *= Math.pow(.0015, dt);
    }
    this.x = Phaser.Math.Clamp(this.x, ARENA_MIN_X, ARENA_MAX_X);
  }

  private updateFacing(opponent: Fighter): void {
    if (this.isKO) return;
    this.facing = opponent.x >= this.x ? 1 : -1;
  }

  private updatePose(): void {
    if (this.state === FighterState.KO) return this.setPose('ko');
    if (this.state === FighterState.VICTORY) return this.setPose('victory');
    if (this.currentAttack) return;
    switch (this.state) {
      case FighterState.WALK: this.setPose(this.vx * this.facing >= 0 ? 'walkForward' : 'walkBack'); break;
      case FighterState.CROUCH: this.setPose('crouch'); break;
      case FighterState.JUMP: this.setPose('jump'); break;
      case FighterState.BLOCK: case FighterState.BLOCKSTUN: this.setPose('block'); break;
      case FighterState.HITSTUN: this.setPose('hit'); break;
      default: this.setPose('idle');
    }
  }

  private setPose(pose: PoseName): void {
    if (this.currentPose === pose && this.sprite.texture.key === SpriteExtractor.textureKey(this.config.id, pose)) return;
    this.currentPose = pose;
    this.sprite.setTexture(SpriteExtractor.textureKey(this.config.id, pose));
    this.normalizeVisual(pose);
  }

  private normalizeVisual(pose: PoseName): void {
    const texture = this.sprite.texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const maxHeight = pose === 'ultimate' ? 330 : pose === 'ko' || pose === 'victory' ? 270 : 250;
    const maxWidth = pose === 'ultimate' ? 520 : 330;
    const scale = Math.min(maxHeight / Math.max(1, texture.height), maxWidth / Math.max(1, texture.width));
    this.baseScale = scale;
    this.sprite.setScale(scale);
    this.sprite.setOrigin(.5, 1);
  }

  private syncVisual(): void {
    this.sprite.setPosition(this.x, this.y).setFlipX(this.facing < 0);
    if (this.state === FighterState.IDLE && !this.isAirborne) {
      const wave = Math.sin(this.scene.time.now / 190) * .012;
      this.sprite.setScale(this.baseScale, this.baseScale * (1 + wave));
      this.sprite.setRotation(Math.sin(this.scene.time.now / 420) * .01 * this.facing);
    } else if (this.state === FighterState.WALK) {
      this.sprite.setScale(this.baseScale);
      this.sprite.setRotation(Math.sin(this.scene.time.now / 70) * .025);
    } else if (this.state === FighterState.JUMP) {
      this.sprite.setScale(this.baseScale, this.baseScale * 1.04);
      this.sprite.setRotation(this.facing * .035);
    } else {
      if (this.currentAttack?.crouching) this.sprite.setScale(this.baseScale * 1.06, this.baseScale * .80);
      else if (!this.currentAttack) this.sprite.setScale(this.baseScale);
      this.sprite.setRotation(0);
    }
  }

  private scaledRecovery(ms: number): number {
    return ms * CONTROL_RECOVERY_MULTIPLIER(this.config.controlStat);
  }
}
