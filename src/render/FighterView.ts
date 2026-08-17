import * as Phaser from 'phaser';
import { FighterState } from '../fighters/FighterState';
import { getFighterConfig } from '../fighters/fighterData';
import { GROUND_Y } from '../sim/constants';
import type { SimFighter } from '../sim/types';
import { poseTextureKey, type PoseName } from '../fighters/poseSheet';

/**
 * Draws one fighter from simulation state.
 *
 * All of this used to live on the Fighter class alongside the physics. The
 * visual-only behaviour is unchanged — including the idle breathing wobble and
 * the landing squash, which read wall-clock time and use tweens. That is fine
 * here precisely because this layer never writes back into the simulation.
 */
export class FighterView {
  readonly sprite: Phaser.GameObjects.Image;
  private currentPose: PoseName = 'idle';
  private baseScale = 1;
  private wasGrounded = true;

  constructor(private readonly scene: Phaser.Scene, fighter: SimFighter) {
    const configId = fighter.configId;
    this.sprite = scene.add
      .image(fighter.x, fighter.y, poseTextureKey(configId, 'idle'))
      .setOrigin(0.5, 1);
    this.normalizeVisual('idle');
  }

  /** Reset for a new round: the sprite may be mid-KO-tint from the last one. */
  reset(): void {
    this.sprite.setVisible(true).setAlpha(1).clearTint().setRotation(0);
    this.currentPose = 'idle';
    this.wasGrounded = true;
    this.setPose('idle', '');
  }

  sync(fighter: SimFighter, nowMs: number): void {
    const grounded = fighter.y >= GROUND_Y - 1;
    if (!this.wasGrounded && grounded && fighter.state !== FighterState.KO) {
      this.squashOnLanding();
    }
    this.wasGrounded = grounded;

    this.setPose(poseFor(fighter), fighter.configId);
    this.applyTransform(fighter, nowMs);
  }

  /** Briefly flash the sprite when it takes a hit. */
  flashHit(): void {
    this.sprite.setAlpha(0.32);
    this.scene.time.delayedCall(55, () => {
      if (this.sprite.active) this.sprite.setAlpha(1);
    });
  }

  /** Scale burst when an ultimate is presented. */
  punchScale(factor: number, durationMs: number): void {
    this.sprite.setScale(this.sprite.scaleX * factor, this.sprite.scaleY * factor);
    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: this.sprite.scaleX / factor,
      scaleY: this.sprite.scaleY / factor,
      duration: durationMs,
      ease: 'Expo.easeOut',
    });
  }

  destroy(): void {
    this.sprite.destroy();
  }

  private squashOnLanding(): void {
    this.sprite.setScale(this.sprite.scaleX, this.sprite.scaleY * 0.9);
    this.scene.tweens.add({
      targets: this.sprite,
      scaleY: Math.abs(this.sprite.scaleX),
      duration: 90,
      ease: 'Back.easeOut',
    });
  }

  private setPose(pose: PoseName, configId: string): void {
    const key = poseTextureKey(configId || this.sprite.texture.key, pose);
    if (this.currentPose === pose && this.sprite.texture.key === key) return;
    this.currentPose = pose;
    this.sprite.setTexture(key);
    this.normalizeVisual(pose);
  }

  private normalizeVisual(pose: PoseName): void {
    const texture = this.sprite.texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const maxHeight = pose === 'ultimate' ? 330 : pose === 'ko' || pose === 'victory' ? 270 : 250;
    const maxWidth = pose === 'ultimate' ? 520 : 330;
    this.baseScale = Math.min(
      maxHeight / Math.max(1, texture.height),
      maxWidth / Math.max(1, texture.width),
    );
    this.sprite.setScale(this.baseScale);
    this.sprite.setOrigin(0.5, 1);
  }

  private applyTransform(fighter: SimFighter, nowMs: number): void {
    this.sprite.setPosition(fighter.x, fighter.y).setFlipX(fighter.facing < 0);
    /**
     * An install has to be visible, or it is a damage buff the opponent has no way
     * to read. The tint is the fighter's own accent colour so it says *who* is
     * buffed rather than just that something happened.
     */
    if (fighter.installTicks > 0) {
      this.sprite.setTint(paletteFor(fighter).accent);
    } else {
      this.sprite.clearTint();
    }
    const airborne = fighter.y < GROUND_Y - 1;

    if (fighter.state === FighterState.IDLE && !airborne) {
      const wave = Math.sin(nowMs / 190) * 0.012;
      this.sprite.setScale(this.baseScale, this.baseScale * (1 + wave));
      this.sprite.setRotation(Math.sin(nowMs / 420) * 0.01 * fighter.facing);
    } else if (fighter.state === FighterState.WALK) {
      this.sprite.setScale(this.baseScale);
      this.sprite.setRotation(Math.sin(nowMs / 70) * 0.025);
    } else if (fighter.state === FighterState.JUMP) {
      this.sprite.setScale(this.baseScale, this.baseScale * 1.04);
      this.sprite.setRotation(fighter.facing * 0.035);
    } else {
      if (fighter.attack?.crouching) {
        this.sprite.setScale(this.baseScale * 1.06, this.baseScale * 0.8);
      } else if (!fighter.attack) {
        this.sprite.setScale(this.baseScale);
      }
      this.sprite.setRotation(0);
    }
  }
}

/**
 * Pose is derived purely from simulation state.
 *
 * The original set some poses imperatively — `receiveImpact` wrote 'hit', 'block'
 * and 'ko' directly. Every one of those coincides with a state the simulation
 * already records, so deriving is equivalent and keeps the view stateless.
 */
export function poseFor(fighter: SimFighter): PoseName {
  switch (fighter.state) {
    case FighterState.KO:
      return 'ko';
    case FighterState.VICTORY:
      return 'victory';
    case FighterState.LIGHT_ATTACK:
      return 'light';
    case FighterState.HEAVY_ATTACK:
      return 'heavy';
    case FighterState.SPECIAL:
      return 'special';
    case FighterState.ULTIMATE:
      return 'ultimate';
    case FighterState.THROW:
      return 'throw';
    case FighterState.H_CHARGING:
      // The upgraded build had three charge frames per fighter in its skill
      // sheets; those are not wired up yet, so a winding-up fighter holds the
      // special pose.
      return 'special';
    case FighterState.BLOCK:
    case FighterState.BLOCKSTUN:
      return 'block';
    case FighterState.HITSTUN:
      return 'hit';
    case FighterState.CROUCH:
      return 'crouch';
    case FighterState.JUMP:
      return 'jump';
    case FighterState.WALK:
      return fighter.vx * fighter.facing >= 0 ? 'walkForward' : 'walkBack';
    default:
      return 'idle';
  }
}

/** Look up the palette a view needs without importing the whole config module. */
export function paletteFor(fighter: SimFighter) {
  return getFighterConfig(fighter.configId).palette;
}
