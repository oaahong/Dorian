import * as Phaser from 'phaser';
import type { Fighter } from '../fighters/Fighter';
import { FighterState } from '../fighters/FighterState';
import type { AttackSpec } from './AttackSpec';
import { ATTACK_MULTIPLIER, COLORS, GAME_HEIGHT, GAME_WIDTH, GROUND_Y } from '../utils/constants';
import { VFXManager } from '../systems/VFXManager';
import { AudioManager } from '../systems/AudioManager';

interface ProjectileRuntime {
  id: number;
  owner: Fighter;
  spec: AttackSpec;
  x: number;
  y: number;
  vx: number;
  width: number;
  height: number;
  lifeMs: number;
  display: Phaser.GameObjects.GameObject & { x: number; y: number; destroy: () => void };
  hitTargets: Set<Fighter>;
}

interface ZoneRuntime {
  id: number;
  owner: Fighter;
  spec: AttackSpec;
  x: number;
  timerMs: number;
  activeMs: number;
  display: Phaser.GameObjects.Arc;
  triggered: boolean;
  hitTargets: Set<Fighter>;
}

export class CombatSystem {
  private projectiles: ProjectileRuntime[] = [];
  private zones: ZoneRuntime[] = [];
  private nextFxId = 1;
  private ultimatePresented = new Set<number>();
  private readonly combatLayer: Phaser.GameObjects.Container;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly vfx: VFXManager,
    world: Phaser.GameObjects.Container,
    private readonly onHitStop: (ms: number) => void,
  ) {
    this.combatLayer = scene.add.container(0, 0).setDepth(50);
    world.add(this.combatLayer);
  }

  update(deltaMs: number, nowMs: number, a: Fighter, b: Fighter): void {
    this.processFighterAttack(a, b, nowMs);
    this.processFighterAttack(b, a, nowMs);
    this.updateProjectiles(deltaMs, nowMs, a, b);
    this.updateZones(deltaMs, nowMs, a, b);
  }

  clear(): void {
    this.projectiles.forEach((p) => p.display.destroy());
    this.zones.forEach((z) => z.display.destroy());
    this.projectiles = [];
    this.zones = [];
    this.ultimatePresented.clear();
    this.combatLayer.removeAll(true);
  }

  destroy(): void {
    this.clear();
    this.combatLayer.destroy(true);
  }

  private processFighterAttack(attacker: Fighter, defender: Fighter, nowMs: number): void {
    const runtime = attacker.currentAttack;
    if (!runtime || attacker.isKO) return;

    if (attacker.state === FighterState.ULTIMATE && !this.ultimatePresented.has(runtime.instanceId)) {
      this.ultimatePresented.add(runtime.instanceId);
      this.presentUltimate(attacker, runtime.spec);
    }

    const spec = runtime.spec;
    if (attacker.attackActive && ['melee', 'dash', 'slide', 'aura'].includes(spec.kind)) {
      if (runtime.activeJustStarted && (spec.kind === 'dash' || spec.kind === 'slide')) {
        this.vfx.afterimage(attacker.sprite, attacker.config.palette.accent);
        this.vfx.speedLines(attacker.x, attacker.y - 110, attacker.facing, attacker.config.palette.secondary);
      }
      this.meleeHit(attacker, defender, spec, runtime.hitTargets, nowMs);
    }
    if (!runtime.activeJustStarted) return;
    if (['melee', 'dash', 'slide', 'aura'].includes(spec.kind)) return;

    switch (spec.kind) {
      case 'sonic': case 'water': case 'salad':
        this.spawnProjectile(attacker, spec);
        runtime.spawnedEffect = true;
        break;
      case 'zone':
        this.spawnZone(attacker, defender, spec);
        runtime.spawnedEffect = true;
        break;
      case 'beam':
        this.beamHit(attacker, defender, spec, runtime.hitTargets, nowMs);
        runtime.spawnedEffect = true;
        break;
      case 'ultimate-salad':
        this.spawnUltimateSaladZone(attacker, defender, spec);
        runtime.spawnedEffect = true;
        break;
      case 'ultimate-water': case 'ultimate-social': case 'ultimate-freeze': case 'ultimate-alien': case 'ultimate-magic':
        this.fullscreenUltimateHit(attacker, defender, spec, runtime.hitTargets, nowMs);
        runtime.spawnedEffect = true;
        break;
      case 'ultimate-ok': case 'ultimate-sonic':
        this.wideUltimateHit(attacker, defender, spec, runtime.hitTargets, nowMs);
        runtime.spawnedEffect = true;
        break;
      default:
        this.meleeHit(attacker, defender, spec, runtime.hitTargets, nowMs);
        runtime.spawnedEffect = true;
    }
  }

  private meleeHit(attacker: Fighter, defender: Fighter, spec: AttackSpec, hitTargets: Set<Fighter>, nowMs: number): void {
    if (hitTargets.has(defender)) return;
    const hitbox = attacker.getMeleeHitbox(spec);
    if (Phaser.Geom.Intersects.RectangleToRectangle(hitbox, defender.getHurtbox())) {
      hitTargets.add(defender);
      const impact = spec.id === 'heavy' ? 'heavy' : spec.id === 'light' ? 'light' : 'special';
      this.resolveHit(attacker, defender, spec, nowMs, impact);
    }
  }

  private spawnProjectile(owner: Fighter, spec: AttackSpec): void {
    const color = spec.kind === 'water' ? COLORS.cyan : spec.kind === 'salad' ? COLORS.green : COLORS.cyan;
    const width = spec.kind === 'water' ? 118 : spec.kind === 'salad' ? 76 : 90;
    const height = spec.kind === 'water' ? 34 : spec.kind === 'salad' ? 54 : 46;
    const x = owner.x + owner.facing * 70;
    const y = owner.y - 118;
    const shape = spec.kind === 'salad'
      ? this.scene.add.ellipse(x, y, width, height, 0xe8e2c4, .95).setStrokeStyle(5, color, 1)
      : this.scene.add.rectangle(x, y, width, height, color, .62).setStrokeStyle(3, 0xffffff, .8);
    this.combatLayer.add(shape);
    this.projectiles.push({ id: this.nextFxId++, owner, spec, x, y, vx: owner.facing * (spec.projectileSpeed ?? 600), width, height, lifeMs: spec.lifetimeMs ?? 900, display: shape, hitTargets: new Set() });
    this.vfx.speedLines(x, y, owner.facing, color);
    if (spec.kind === 'salad') this.vfx.pixelBlocks(COLORS.green, 10);
  }

  private updateProjectiles(deltaMs: number, nowMs: number, a: Fighter, b: Fighter): void {
    const dt = deltaMs / 1000;
    const survivors: ProjectileRuntime[] = [];
    for (const projectile of this.projectiles) {
      projectile.lifeMs -= deltaMs;
      projectile.x += projectile.vx * dt;
      projectile.display.x = projectile.x;
      projectile.display.y = projectile.y;
      const target = projectile.owner === a ? b : a;
      const rect = new Phaser.Geom.Rectangle(projectile.x - projectile.width / 2, projectile.y - projectile.height / 2, projectile.width, projectile.height);
      if (!projectile.hitTargets.has(target) && !target.isKO && Phaser.Geom.Intersects.RectangleToRectangle(rect, target.getHurtbox())) {
        projectile.hitTargets.add(target);
        this.resolveHit(projectile.owner, target, projectile.spec, nowMs, 'special');
        projectile.display.destroy();
        continue;
      }
      if (projectile.lifeMs <= 0 || projectile.x < -100 || projectile.x > GAME_WIDTH + 100) projectile.display.destroy();
      else survivors.push(projectile);
    }
    this.projectiles = survivors;
  }

  private spawnZone(owner: Fighter, defender: Fighter, spec: AttackSpec): void {
    const x = Phaser.Math.Clamp(defender.x + defender.vx * .15, 120, GAME_WIDTH - 120);
    const circle = this.scene.add.circle(x, GROUND_Y - 8, 72, COLORS.purple, .12).setStrokeStyle(5, COLORS.purple, .9).setScale(1, .35);
    this.combatLayer.add(circle);
    this.zones.push({ id:this.nextFxId++, owner, spec, x, timerMs:spec.telegraphMs ?? 450, activeMs:spec.activeMs, display:circle, triggered:false, hitTargets:new Set() });
    this.scene.tweens.add({ targets: circle, alpha: .7, scaleX: 1.15, duration: 180, yoyo: true, repeat: 1 });
  }

  private spawnUltimateSaladZone(owner: Fighter, defender: Fighter, spec: AttackSpec): void {
    const x = Phaser.Math.Clamp(defender.x, 130, GAME_WIDTH - 130);
    const circle = this.scene.add.circle(x, GROUND_Y - 8, 100, COLORS.green, .18).setStrokeStyle(6, COLORS.gold, 1).setScale(1, .32);
    this.combatLayer.add(circle);
    this.zones.push({ id:this.nextFxId++, owner, spec, x, timerMs:spec.telegraphMs ?? 500, activeMs:220, display:circle, triggered:false, hitTargets:new Set() });
    this.vfx.popup('HEALTHY IMPACT INCOMING', x, GROUND_Y - 110, COLORS.green, 20);
  }

  private updateZones(deltaMs: number, nowMs: number, a: Fighter, b: Fighter): void {
    const survivors: ZoneRuntime[] = [];
    for (const zone of this.zones) {
      const target = zone.owner === a ? b : a;
      if (!zone.triggered) {
        zone.timerMs -= deltaMs;
        if (zone.timerMs <= 0) {
          zone.triggered = true;
          zone.display.setFillStyle(zone.spec.kind === 'ultimate-salad' ? COLORS.green : COLORS.purple, .55).setScale(1.05, 1.5);
          this.vfx.shockwave(zone.x, GROUND_Y - 80, zone.spec.kind === 'ultimate-salad' ? COLORS.green : COLORS.purple, 150);
          this.vfx.pixelBlocks(zone.spec.kind === 'ultimate-salad' ? COLORS.green : COLORS.purple, 18);
        }
      } else {
        zone.activeMs -= deltaMs;
        const hurt = target.getHurtbox();
        const inZone = Math.abs(target.x - zone.x) < (zone.spec.kind === 'ultimate-salad' ? 150 : 100) && hurt.bottom > GROUND_Y - 250;
        if (inZone && !zone.hitTargets.has(target)) {
          zone.hitTargets.add(target);
          this.resolveHit(zone.owner, target, zone.spec, nowMs, zone.spec.kind === 'ultimate-salad' ? 'ultimate' : 'special');
        }
        if (zone.activeMs <= 0) {
          zone.display.destroy();
          continue;
        }
      }
      survivors.push(zone);
    }
    this.zones = survivors;
  }

  private beamHit(attacker: Fighter, defender: Fighter, spec: AttackSpec, hitTargets: Set<Fighter>, nowMs: number): void {
    const width = spec.reach;
    const x = attacker.facing > 0 ? attacker.x + width / 2 + 45 : attacker.x - width / 2 - 45;
    const y = attacker.y - 122;
    const beam = this.scene.add.rectangle(x, y, width, 46, COLORS.green, .58).setStrokeStyle(4, 0xcffff0, .9);
    this.combatLayer.add(beam);
    this.scene.tweens.add({ targets: beam, alpha: 0, scaleY: 1.7, duration: 220, onComplete: () => beam.destroy() });
    this.vfx.speedLines(attacker.x, y, attacker.facing, COLORS.green);
    const rect = new Phaser.Geom.Rectangle(x - width / 2, y - 30, width, 60);
    if (!hitTargets.has(defender) && Phaser.Geom.Intersects.RectangleToRectangle(rect, defender.getHurtbox())) {
      hitTargets.add(defender);
      this.resolveHit(attacker, defender, spec, nowMs, 'special');
    }
  }

  private wideUltimateHit(attacker: Fighter, defender: Fighter, spec: AttackSpec, hitTargets: Set<Fighter>, nowMs: number): void {
    const reach = spec.reach;
    const x = attacker.facing > 0 ? attacker.x + reach / 2 : attacker.x - reach / 2;
    const rect = new Phaser.Geom.Rectangle(x - reach / 2, 120, reach, GROUND_Y - 70);
    this.vfx.shockwave(attacker.x + attacker.facing * 150, attacker.y - 130, COLORS.purple, 260);
    this.vfx.pixelBlocks(COLORS.purple, 34);
    if (!hitTargets.has(defender) && Phaser.Geom.Intersects.RectangleToRectangle(rect, defender.getHurtbox())) {
      hitTargets.add(defender);
      this.resolveHit(attacker, defender, spec, nowMs, 'ultimate');
    }
  }

  private fullscreenUltimateHit(attacker: Fighter, defender: Fighter, spec: AttackSpec, hitTargets: Set<Fighter>, nowMs: number): void {
    if (hitTargets.has(defender)) return;
    hitTargets.add(defender);
    const color = spec.kind === 'ultimate-alien' ? COLORS.green : spec.kind === 'ultimate-freeze' || spec.kind === 'ultimate-water' ? COLORS.cyan : COLORS.purple;
    this.vfx.shockwave(defender.x, defender.y - 110, color, 310);
    this.vfx.pixelBlocks(color, 42);
    this.resolveHit(attacker, defender, spec, nowMs, 'ultimate');
  }

  private presentUltimate(attacker: Fighter, spec: AttackSpec): void {
    const color = attacker.config.palette.accent;
    const overlay = this.vfx.ultimateBackdrop(color, 1250);
    this.vfx.popup(spec.name, GAME_WIDTH / 2, 155, COLORS.white, 48);
    this.vfx.flash(COLORS.white, .32, 85);
    this.vfx.shake(.012, 360);
    this.vfx.pixelBlocks(color, 30);
    this.onHitStop(120);
    attacker.sprite.setScale(attacker.sprite.scaleX * 1.45, attacker.sprite.scaleY * 1.45);
    this.scene.tweens.add({ targets: attacker.sprite, scaleX: attacker.sprite.scaleX / 1.45, scaleY: attacker.sprite.scaleY / 1.45, duration: 680, ease: 'Expo.easeOut' });
    this.scene.time.delayedCall(1250, () => overlay.destroy());
  }

  private resolveHit(attacker: Fighter, defender: Fighter, spec: AttackSpec, nowMs: number, impact: 'light' | 'heavy' | 'special' | 'ultimate'): void {
    if (defender.isKO) return;
    const blocked = defender.canBlockImpact;
    const multiplier = ATTACK_MULTIPLIER(attacker.config.attackStat);
    const hpStatMitigation = 1.08 - defender.config.hpStat * 0.03;
    const fullDamage = spec.damage * multiplier * hpStatMitigation;
    const damage = blocked ? fullDamage * (spec.chipRatio ?? 0) : fullDamage;
    defender.receiveImpact(damage, spec, attacker.facing, blocked, nowMs);

    if (!blocked) {
      attacker.addEnergy(spec.energyOnHit);
      defender.addEnergy(spec.energyOnReceive);
    } else if ((spec.chipRatio ?? 0) > 0) {
      attacker.addEnergy(Math.ceil(spec.energyOnHit * .35));
      defender.addEnergy(Math.ceil(spec.energyOnReceive * .35));
    }

    const x = defender.x - attacker.facing * 18;
    const y = defender.y - 120;
    if (blocked) {
      this.vfx.blockSpark(x, y);
      AudioManager.play('block');
      this.onHitStop(35);
      return;
    }

    const heavy = impact !== 'light';
    const color = impact === 'ultimate' ? attacker.config.palette.accent : impact === 'special' ? attacker.config.palette.secondary : COLORS.gold;
    this.vfx.hitSpark(x, y, heavy, color);
    this.vfx.memePopup(x, y);
    defender.sprite.setAlpha(.32);
    this.scene.time.delayedCall(55, () => { if (defender.sprite.active) defender.sprite.setAlpha(1); });

    if (impact === 'light') { AudioManager.play('light'); this.onHitStop(45); }
    else if (impact === 'heavy') { AudioManager.play('heavy'); this.vfx.shake(.005, 100); this.onHitStop(80); }
    else if (impact === 'special') { AudioManager.play('special'); this.vfx.shake(.007, 130); this.onHitStop(95); }
    else { AudioManager.play('ultimate'); this.vfx.flash(COLORS.white, .46, 90); this.vfx.shake(.012, 220); this.onHitStop(150); }
  }
}
