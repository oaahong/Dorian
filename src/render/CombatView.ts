import * as Phaser from 'phaser';
import { getSpec } from '../sim/attackSpecs';
import { GROUND_Y } from '../sim/constants';
import type { SimEvent, SimProjectile, SimWorld, SimZone } from '../sim/types';
import { COLORS } from '../utils/constants';
import { VFXManager } from '../systems/VFXManager';

/**
 * Draws projectiles, zones and beams.
 *
 * The simulation used to hold the Phaser display object inside each projectile
 * record, which is what made the combat state impossible to snapshot. Now the
 * simulation owns plain records with ids and this view keeps a parallel map of
 * sprites keyed by the same id, created and destroyed from the event stream.
 */
export class CombatView {
  private readonly layer: Phaser.GameObjects.Container;
  private readonly projectileSprites = new Map<number, Phaser.GameObjects.Shape>();
  private readonly zoneSprites = new Map<number, Phaser.GameObjects.Arc>();

  constructor(
    private readonly scene: Phaser.Scene,
    world: Phaser.GameObjects.Container,
    private readonly vfx: VFXManager,
  ) {
    this.layer = scene.add.container(0, 0).setDepth(50);
    world.add(this.layer);
  }

  handle(event: SimEvent): void {
    switch (event.t) {
      case 'projectileSpawn':
        this.spawnProjectile(event.id, event.specId, event.x, event.y);
        break;
      case 'projectileEnd':
        this.destroyEntity(this.projectileSprites, event.id);
        break;
      case 'zoneSpawn':
        this.spawnZone(event.id, event.specId, event.x);
        break;
      case 'zoneTrigger':
        this.triggerZone(event.id);
        break;
      case 'zoneEnd':
        this.destroyEntity(this.zoneSprites, event.id);
        break;
      case 'beam':
        this.drawBeam(event.x, event.y, event.width);
        break;
      default:
        break;
    }
  }

  /** Move the sprites to match this tick's simulation positions. */
  sync(world: SimWorld): void {
    for (const projectile of world.projectiles) {
      this.projectileSprites.get(projectile.id)?.setPosition(projectile.x, projectile.y);
    }
  }

  clear(): void {
    for (const sprite of this.projectileSprites.values()) sprite.destroy();
    for (const sprite of this.zoneSprites.values()) sprite.destroy();
    this.projectileSprites.clear();
    this.zoneSprites.clear();
    this.layer.removeAll(true);
  }

  destroy(): void {
    this.clear();
    this.layer.destroy(true);
  }

  private spawnProjectile(id: number, specId: string, x: number, y: number): void {
    const spec = getSpec(specId);
    const color = spec.kind === 'salad' ? COLORS.green : COLORS.cyan;
    const width = spec.kind === 'water' ? 118 : spec.kind === 'salad' ? 76 : 90;
    const height = spec.kind === 'water' ? 34 : spec.kind === 'salad' ? 54 : 46;

    const shape =
      spec.kind === 'salad'
        ? this.scene.add.ellipse(x, y, width, height, 0xe8e2c4, 0.95).setStrokeStyle(5, color, 1)
        : this.scene.add
            .rectangle(x, y, width, height, color, 0.62)
            .setStrokeStyle(3, 0xffffff, 0.8);

    this.layer.add(shape);
    this.projectileSprites.set(id, shape);
    this.vfx.speedLines(x, y, Math.sign(x) || 1, color);
    if (spec.kind === 'salad') this.vfx.pixelBlocks(COLORS.green, 10);
  }

  private spawnZone(id: number, specId: string, x: number): void {
    const spec = getSpec(specId);
    const ultimate = spec.kind === 'ultimate-salad';
    const circle = this.scene.add
      .circle(x, GROUND_Y - 8, ultimate ? 100 : 72, ultimate ? COLORS.green : COLORS.purple, ultimate ? 0.18 : 0.12)
      .setStrokeStyle(ultimate ? 6 : 5, ultimate ? COLORS.gold : COLORS.purple, ultimate ? 1 : 0.9)
      .setScale(1, ultimate ? 0.32 : 0.35);

    this.layer.add(circle);
    this.zoneSprites.set(id, circle);

    if (ultimate) {
      this.vfx.popup('HEALTHY IMPACT INCOMING', x, GROUND_Y - 110, COLORS.green, 20);
    } else {
      this.scene.tweens.add({
        targets: circle,
        alpha: 0.7,
        scaleX: 1.15,
        duration: 180,
        yoyo: true,
        repeat: 1,
      });
    }
  }

  private triggerZone(id: number): void {
    const circle = this.zoneSprites.get(id);
    if (!circle) return;
    circle.setFillStyle(COLORS.purple, 0.55).setScale(1.05, 1.5);
    this.vfx.shockwave(circle.x, GROUND_Y - 80, COLORS.purple, 150);
    this.vfx.pixelBlocks(COLORS.purple, 18);
  }

  private drawBeam(x: number, y: number, width: number): void {
    const beam = this.scene.add
      .rectangle(x, y, width, 46, COLORS.green, 0.58)
      .setStrokeStyle(4, 0xcffff0, 0.9);
    this.layer.add(beam);
    this.scene.tweens.add({
      targets: beam,
      alpha: 0,
      scaleY: 1.7,
      duration: 220,
      onComplete: () => beam.destroy(),
    });
  }

  private destroyEntity(
    map: Map<number, Phaser.GameObjects.GameObject & { destroy: () => void }>,
    id: number,
  ): void {
    map.get(id)?.destroy();
    map.delete(id);
  }
}

/** Narrow helper so the map types above stay readable. */
export type CombatEntity = SimProjectile | SimZone;
