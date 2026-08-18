import * as Phaser from 'phaser';
import { ultimateVisualsFor, type VisualBeat } from '../fighters/ultimateVisuals';
import { GROUND_Y } from '../sim/constants';
import type { SimUltimate, SimWorld } from '../sim/types';
import { VFXManager } from '../systems/VFXManager';
import { fitToHeight } from './fit';
import { beatsBetween, expandBeats, type ScheduledBeat } from './ultimateSchedule';

/**
 * Draws the twelve ultimates.
 *
 * A shell over `ultimateVisuals.ts`: it owns Phaser objects and nothing else. It
 * decides no timing — `ultimateSchedule.beatsBetween` does that, and is tested
 * without a browser — and it reads no state the simulation does not already
 * publish. Adding a fighter's ultimate means adding a script, never touching this
 * file.
 *
 * Ultimates are tracked by their owner's seat rather than by an entity id because
 * `SimUltimate` has no id of its own and there is at most one per fighter, which
 * is also why the map is two entries and not a pool.
 */

/** Skill textures sit above the fighters but below the HUD. */
const DEFAULT_DEPTH = 22;

/** How far a `scatter` beat throws its copies, and how many it makes. */
const SCATTER_COPIES = 3;
const SCATTER_SPREAD_X = 190;
const SCATTER_SPREAD_Y = 90;

/** Ticks are the script's unit; tweens want milliseconds. */
const MS_PER_TICK = 1000 / 60;

interface Playing {
  beats: ScheduledBeat[];
  /** The last tick whose beats have been played, so none is played twice. */
  lastTick: number;
}

export class UltimateStage {
  private readonly layer: Phaser.GameObjects.Container;
  private readonly playing = new Map<number, Playing>();
  /** Live sprites, so a round ending mid-ultimate leaves nothing behind. */
  private sprites = new Set<Phaser.GameObjects.Image>();

  constructor(
    private readonly scene: Phaser.Scene,
    world: Phaser.GameObjects.Container,
    private readonly vfx: VFXManager,
  ) {
    this.layer = scene.add.container(0, 0).setDepth(40);
    world.add(this.layer);
  }

  /** How many objects the stage currently has on screen. Read by the perf tests. */
  get liveObjectCount(): number {
    return this.sprites.size;
  }

  /**
   * Play whatever is due.
   *
   * Called once per frame with the whole world, and reconciled from
   * `world.ultimates` rather than from events: an ultimate that is simply *gone*
   * this frame — knocked out of, round over, scene left — is all the signal the
   * stage needs to stop, and that is one less thing to keep in step.
   */
  sync(world: SimWorld): void {
    const active = new Set<number>();

    for (const ultimate of world.ultimates) {
      active.add(ultimate.ownerIndex);
      let state = this.playing.get(ultimate.ownerIndex);
      if (!state) {
        state = { beats: expandBeats(ultimateVisualsFor(ultimate.fighterId).beats), lastTick: 0 };
        this.playing.set(ultimate.ownerIndex, state);
      }

      // The interval, not the instant. A frame can advance several ticks, and
      // matching on equality would drop beats on exactly the machines that can
      // least afford to lose them. See `ultimateSchedule`.
      const due = beatsBetween(state.beats, state.lastTick, ultimate.elapsedTicks);
      state.lastTick = Math.max(state.lastTick, ultimate.elapsedTicks);
      for (const beat of due) this.play(beat, ultimate, world);
    }

    for (const owner of [...this.playing.keys()]) {
      if (!active.has(owner)) this.playing.delete(owner);
    }
  }

  /** Drop everything: a round ended, or the scene is going away. */
  clear(): void {
    for (const sprite of this.sprites) sprite.destroy();
    this.sprites.clear();
    this.playing.clear();
    this.layer.removeAll(true);
  }

  destroy(): void {
    this.clear();
    this.layer.destroy(true);
  }

  private play(beat: ScheduledBeat, ultimate: SimUltimate, world: SimWorld): void {
    const owner = world.fighters[ultimate.ownerIndex];
    const key = `skill-${ultimate.fighterId}-${beat.cell.toLowerCase()}`;
    // A missing texture is a typo or a failed load. Skipping is right here and
    // wrong for a summon: this draws decoration, and decoration that cannot be
    // drawn is better absent than replaced by a magenta box.
    if (!this.scene.textures.exists(key)) return;

    const x = this.anchorX(beat, ultimate, world);
    const y = beat.y ?? GROUND_Y;
    const copies = beat.fx === 'scatter' ? SCATTER_COPIES : 1;

    for (let copy = 0; copy < copies; copy += 1) {
      const jitterX = copy === 0 && copies === 1 ? 0 : (Math.random() - 0.5) * SCATTER_SPREAD_X;
      const jitterY = copy === 0 && copies === 1 ? 0 : (Math.random() - 0.5) * SCATTER_SPREAD_Y;
      this.spawn(beat, key, x + jitterX, y + jitterY, owner.facing, ultimate, world);
    }

    if (beat.fx === 'flash') this.vfx.flash(0xffffff, 0.5, 90);
    if (beat.fx === 'shake') this.vfx.shake(0.012, 150);
  }

  private spawn(
    beat: VisualBeat,
    key: string,
    x: number,
    y: number,
    facing: number,
    ultimate: SimUltimate,
    world: SimWorld,
  ): void {
    const sprite = this.scene.add
      .image(x, y, key)
      .setOrigin(0.5, 1)
      .setDepth(beat.depth ?? DEFAULT_DEPTH);
    fitToHeight(sprite, beat.height ?? 220);
    if (beat.flipToFacing) sprite.setFlipX(facing < 0);

    this.layer.add(sprite);
    this.sprites.add(sprite);

    if (beat.fx === 'rotateToTarget') {
      const target = this.lockedX(ultimate, world);
      sprite.setOrigin(0, 0.5).setRotation(Phaser.Math.Angle.Between(x, y, target, GROUND_Y - 120));
    }

    const lifeMs = (beat.lifeTicks ?? 26) * MS_PER_TICK;

    if (beat.fx === 'fallFromSky') {
      this.scene.tweens.add({
        targets: sprite,
        y: GROUND_Y,
        duration: lifeMs,
        ease: 'Quad.easeIn',
        onComplete: () => this.retire(sprite),
      });
      return;
    }

    this.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      duration: lifeMs,
      ease: 'Quad.easeIn',
      onComplete: () => this.retire(sprite),
    });
  }

  private retire(sprite: Phaser.GameObjects.Image): void {
    this.sprites.delete(sprite);
    if (sprite.active) sprite.destroy();
  }

  private anchorX(beat: VisualBeat, ultimate: SimUltimate, world: SimWorld): number {
    const offset = beat.offsetX ?? 0;
    const owner = world.fighters[ultimate.ownerIndex];
    const opponent = world.fighters[ultimate.ownerIndex === 0 ? 1 : 0];

    switch (beat.anchor) {
      case 'owner':
        // Offsets on the owner are written as "in front of me", so they follow the
        // way the fighter is looking rather than the way the screen does.
        return owner.x + offset * owner.facing;
      case 'opponent':
        return opponent.x + offset;
      case 'lockedTarget':
        return this.lockedX(ultimate, world) + offset;
      case 'absolute':
        return offset;
      case 'screen':
      default:
        return this.scene.scale.width / 2 + offset;
    }
  }

  /**
   * Where the move locked on.
   *
   * Falls back to the opponent's current position before the lock tick, when
   * `lockedTargetX` is by definition meaningless — a beat drawn there would
   * otherwise appear at x = 0 for the first few frames.
   */
  private lockedX(ultimate: SimUltimate, world: SimWorld): number {
    const opponent = world.fighters[ultimate.ownerIndex === 0 ? 1 : 0];
    return ultimate.lockedTargetX || opponent.x;
  }
}
