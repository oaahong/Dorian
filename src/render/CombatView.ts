import * as Phaser from 'phaser';
import { getSpec } from '../sim/attackSpecs';
import { GROUND_Y } from '../sim/constants';
import { summonTextureKey } from '../fighters/poseSheet';
import { summonArtFor, summonCellFor } from '../fighters/summonArt';
import type { SimEvent, SimProjectile, SimWorld, SimZone } from '../sim/types';
import { COLORS } from '../utils/constants';
import { VFXManager } from '../systems/VFXManager';
import { fitToHeight } from './fit';
import { effectTextureFor, needsReleaseFlash } from './effectCells';

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

/** How long a companion is drawn flinching after its hit points drop. */
const HURT_FLASH_MS = 220;

/**
 * How large a charge special's own art draws.
 *
 * Fitted to a height rather than scaled, because the three levels are three
 * separate images with three different resolutions — see `fit.ts`. The width a
 * beam ends up with comes from the simulation's reach, not from here.
 */
const PROJECTILE_ART_HEIGHT = 88;
const ZONE_ART_HEIGHT = 120;
const BEAM_ART_HEIGHT = 96;

/** Where a melee charge's effect appears relative to the fighter, and how far it goes. */
const CHARGE_FLASH_OFFSET_X = 70;
const CHARGE_FLASH_TRAVEL = 60;
const CHARGE_FLASH_HEIGHT = 150;

export class CombatView {
  private readonly layer: Phaser.GameObjects.Container;
  /**
   * Projectiles draw either as their own art or as a fallback shape, so the map
   * holds whichever the spec produced. Both are positioned the same way.
   */
  private readonly projectileSprites = new Map<
    number,
    Phaser.GameObjects.Shape | Phaser.GameObjects.Image
  >();
  private readonly zoneSprites = new Map<number, Phaser.GameObjects.Arc>();
  /** Charge-special art laid under a zone, cleared with it. */
  private readonly zoneArtwork = new Map<number, Phaser.GameObjects.Image>();
  private readonly summonSprites = new Map<number, Phaser.GameObjects.Image>();
  /** Last seen hit points per companion, so a drop can be noticed as a hit. */
  private readonly summonHp = new Map<number, number>();
  /** When a companion stops being drawn flinching. */
  private readonly hurtUntil = new Map<number, number>();
  /** The frame each companion leaves on, remembered before it is gone. */
  private readonly despawnKeys = new Map<number, string>();

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
        this.destroyEntity(this.zoneArtwork, event.id);
        break;
      case 'beam':
        this.drawBeam(event.specId, event.x, event.y, event.width);
        break;
      default:
        break;
    }
  }

  /**
   * The charge special's art, at the fighter, for the six that spawn no entity.
   *
   * doge charges, goblin grabs, blade swings, salad shoves — nothing goes into the
   * world for the art to ride on, so it is drawn here or not at all. It flies
   * forward a little and fades, which reads as the swing having weight rather than
   * as a picture appearing.
   */
  flashChargeEffect(specId: string, x: number, y: number, facing: number): void {
    if (!needsReleaseFlash(specId)) return;
    const artwork = this.artworkFor(specId, x + facing * CHARGE_FLASH_OFFSET_X, y, CHARGE_FLASH_HEIGHT);
    if (!artwork) return;

    artwork.setFlipX(facing < 0).setDepth(24);
    this.layer.add(artwork);
    this.scene.tweens.add({
      targets: artwork,
      x: artwork.x + facing * CHARGE_FLASH_TRAVEL,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => artwork.destroy(),
    });
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
      const art = summonArtFor(ultimate.fighterId);
      const fallback = summonTextureKey(ultimate.fighterId);
      const opponent = world.fighters[ultimate.ownerIndex === 0 ? 1 : 0];

      for (const summon of ultimate.summons) {
        alive.add(summon.id);
        const previousHp = this.summonHp.get(summon.id);
        const hurt = previousHp !== undefined && summon.hp < previousHp;
        if (hurt) this.hurtUntil.set(summon.id, this.scene.time.now + HURT_FLASH_MS);
        this.summonHp.set(summon.id, summon.hp);

        const cell =
          art &&
          summonCellFor(art, summon, ultimate.fighterId, {
            hurt: (this.hurtUntil.get(summon.id) ?? 0) > this.scene.time.now,
            distanceToTarget: Math.abs(opponent.x - summon.x),
          });
        const key = cell ? `skill-${ultimate.fighterId}-${cell.toLowerCase()}` : fallback;

        // Remembered now, because by the time it is needed the companion is gone
        // from the world and there is nothing left to look its fighter up from.
        if (art?.despawn) {
          this.despawnKeys.set(summon.id, `skill-${ultimate.fighterId}-${art.despawn.toLowerCase()}`);
        }

        /**
         * A companion with no art still has to be *visible*, because it still has
         * a hitbox. Falling through to nothing would leave an invisible thing on
         * the field dealing damage, which is the worst failure this code can have
         * — far worse than a plain rectangle.
         */
        const drawable = key !== null && this.scene.textures.exists(key);

        let sprite = this.summonSprites.get(summon.id);
        if (!sprite) {
          sprite = drawable
            ? this.scene.add.image(summon.x, summon.y, key).setOrigin(0.5, 1).setDepth(12)
            : this.placeholderSummon(summon.x, summon.y);
          this.layer.add(sprite);
          this.summonSprites.set(summon.id, sprite);
        } else if (drawable && sprite.texture.key !== key) {
          sprite.setTexture(key);
        }
        // Refitted on every swap: the poses are separate images with separate
        // resolutions, so a husky mid-leap would otherwise change size.
        if (drawable) fitToHeight(sprite, SUMMON_HEIGHT);
        // Facing the opponent, like everything else that can hit them.
        sprite.setPosition(summon.x, summon.y).setFlipX(opponent.x < summon.x);
      }
    }

    for (const [id, sprite] of this.summonSprites) {
      if (alive.has(id)) continue;
      this.retireSummon(id, sprite);
    }
  }

  /**
   * A companion leaving the field.
   *
   * Both sheets drew this — tempura's clone puffs out, scared's husky dissolves —
   * so the sprite is swapped to that and faded rather than simply deleted. Nine
   * clones being cleared out one at a time is a good part of that ultimate, and
   * vanishing on the frame they die reads as a rendering bug.
   */
  private retireSummon(id: number, sprite: Phaser.GameObjects.Image): void {
    this.summonSprites.delete(id);
    this.summonHp.delete(id);
    this.hurtUntil.delete(id);

    const key = this.despawnKeys.get(id);
    this.despawnKeys.delete(id);
    this.vfx.hitSpark(sprite.x, sprite.y - SUMMON_HEIGHT / 2, false, COLORS.cream);

    if (key && this.scene.textures.exists(key)) {
      sprite.setTexture(key);
      fitToHeight(sprite, SUMMON_HEIGHT);
      this.scene.tweens.add({
        targets: sprite,
        alpha: 0,
        duration: 280,
        onComplete: () => sprite.destroy(),
      });
      return;
    }
    sprite.destroy();
  }

  clear(): void {
    for (const sprite of this.projectileSprites.values()) sprite.destroy();
    for (const sprite of this.zoneSprites.values()) sprite.destroy();
    for (const sprite of this.summonSprites.values()) sprite.destroy();
    for (const sprite of this.zoneArtwork.values()) sprite.destroy();
    this.summonHp.clear();
    this.hurtUntil.clear();
    this.despawnKeys.clear();
    this.projectileSprites.clear();
    this.zoneSprites.clear();
    this.zoneArtwork.clear();
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

    // A charge special was drawn, at all three strengths. Everything else keeps
    // the shape it has always had — see `effectTextureFor` for why there is no
    // fallback from one to the other.
    const artwork = this.artworkFor(specId, x, y, PROJECTILE_ART_HEIGHT);
    const shape =
      artwork ??
      (spec.kind === 'salad'
        ? this.scene.add.ellipse(x, y, width, height, 0xe8e2c4, 0.95).setStrokeStyle(5, color, 1)
        : this.scene.add
            .rectangle(x, y, width, height, color, 0.62)
            .setStrokeStyle(3, 0xffffff, 0.8));

    this.layer.add(shape);
    this.projectileSprites.set(id, shape);
    this.vfx.speedLines(x, y, Math.sign(x) || 1, color);
    if (spec.kind === 'salad') this.vfx.pixelBlocks(COLORS.green, 10);
  }

  /**
   * The charge special's own art, sized to the entity it stands for.
   *
   * Returns null for every other move, so the caller falls through to the shape it
   * already drew rather than to nothing.
   */
  private artworkFor(
    specId: string,
    x: number,
    y: number,
    height: number,
  ): Phaser.GameObjects.Image | null {
    const key = effectTextureFor(specId);
    if (!key || !this.scene.textures.exists(key)) return null;
    const image = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5);
    fitToHeight(image, height);
    return image;
  }

  private spawnZone(id: number, specId: string, x: number): void {
    const spec = getSpec(specId);
    const ultimate = spec.kind === 'ultimate-salad';

    // A charged zone — ya's awkwardness, wizard's magic circle — is a picture, and
    // it lies flat on the floor where the box is.
    const artwork = this.artworkFor(specId, x, GROUND_Y - 8, ZONE_ART_HEIGHT);
    if (artwork) {
      artwork.setDepth(4);
      this.layer.add(artwork);
      this.zoneArtwork.set(id, artwork);
      this.scene.tweens.add({
        targets: artwork,
        alpha: { from: 0.55, to: 0.95 },
        duration: 240,
        yoyo: true,
        repeat: -1,
      });
    }

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

  private drawBeam(specId: string, x: number, y: number, width: number): void {
    const artwork = this.artworkFor(specId, x, y, BEAM_ART_HEIGHT);
    if (artwork) {
      // Stretched to the reach the simulation actually gave it, so a level 3 beam
      // is visibly the one that crosses the arena.
      artwork.setDisplaySize(width, artwork.displayHeight);
      this.layer.add(artwork);
      this.scene.tweens.add({
        targets: artwork,
        alpha: 0,
        duration: 240,
        onComplete: () => artwork.destroy(),
      });
      return;
    }

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
