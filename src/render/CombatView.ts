import * as Phaser from 'phaser';
import { getSpec } from '../sim/attackSpecs';
import { GROUND_Y } from '../sim/constants';
import { summonTextureKey } from '../fighters/poseSheet';
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
/** How tall a companion draws, so nine of them read as a crowd and not a wall. */
const SUMMON_HEIGHT = 150;

/** Scale an image to a target height, whatever its source resolution is. */
function fitToHeight(sprite: Phaser.GameObjects.Image, height: number): void {
  const source = sprite.texture.getSourceImage() as { height: number };
  sprite.setScale(height / Math.max(1, source.height));
}

export class CombatView {
  private readonly layer: Phaser.GameObjects.Container;
  private readonly projectileSprites = new Map<number, Phaser.GameObjects.Shape>();
  private readonly zoneSprites = new Map<number, Phaser.GameObjects.Arc>();
  private readonly summonSprites = new Map<number, Phaser.GameObjects.Image>();

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
    this.syncSummons(world);
  }

  /**
   * Companions are reconciled from the world rather than from events.
   *
   * They come and go in groups — nine clones arrive on one tick and are knocked
   * down one at a time — and an id that is simply *absent* this frame is all the
   * signal a sprite needs to be destroyed. Spawn and death events would be two
   * more things to keep in step with a list that is already right there.
   */
  private syncSummons(world: SimWorld): void {
    const alive = new Set<number>();

    for (const ultimate of world.ultimates) {
      const key = summonTextureKey(ultimate.fighterId);
      /**
       * A companion with no art still has to be *visible*, because it still has a
       * hitbox. Falling through to nothing would leave an invisible thing on the
       * field dealing damage, which is the worst failure this code can have — far
       * worse than a plain rectangle.
       */
      const drawable = key !== null && this.scene.textures.exists(key);

      for (const summon of ultimate.summons) {
        alive.add(summon.id);
        let sprite = this.summonSprites.get(summon.id);
        if (!sprite) {
          sprite = drawable
            ? this.scene.add.image(summon.x, summon.y, key!).setOrigin(0.5, 1).setDepth(12)
            : this.placeholderSummon(summon.x, summon.y);
          if (drawable) fitToHeight(sprite, SUMMON_HEIGHT);
          this.layer.add(sprite);
          this.summonSprites.set(summon.id, sprite);
        }
        // Facing the opponent, like everything else that can hit them.
        const opponent = world.fighters[ultimate.ownerIndex === 0 ? 1 : 0];
        sprite.setPosition(summon.x, summon.y).setFlipX(opponent.x < summon.x);
      }
    }

    for (const [id, sprite] of this.summonSprites) {
      if (alive.has(id)) continue;
      this.vfx.hitSpark(sprite.x, sprite.y - SUMMON_HEIGHT / 2, false, COLORS.cream);
      sprite.destroy();
      this.summonSprites.delete(id);
    }
  }

  clear(): void {
    for (const sprite of this.projectileSprites.values()) sprite.destroy();
    for (const sprite of this.zoneSprites.values()) sprite.destroy();
    for (const sprite of this.summonSprites.values()) sprite.destroy();
    this.projectileSprites.clear();
    this.zoneSprites.clear();
    this.summonSprites.clear();
    this.layer.removeAll(true);
  }

  destroy(): void {
    this.clear();
    this.layer.destroy(true);
  }

  /**
   * The stand-in for a companion whose art is missing. Deliberately ugly: it is
   * meant to be noticed, and it is still better than an invisible attacker.
   */
  private placeholderSummon(x: number, y: number): Phaser.GameObjects.Image {
    const key = 'summon-placeholder';
    if (!this.scene.textures.exists(key)) {
      const texture = this.scene.textures.createCanvas(key, 84, SUMMON_HEIGHT);
      const context = texture?.getContext();
      if (context) {
        context.fillStyle = '#ff00aa';
        context.fillRect(0, 0, 84, SUMMON_HEIGHT);
        texture?.refresh();
      }
    }
    return this.scene.add.image(x, y, key).setOrigin(0.5, 1).setDepth(12).setAlpha(0.85);
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
