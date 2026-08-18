import * as Phaser from 'phaser';
import { FighterState } from '../fighters/FighterState';
import { getFighterConfig } from '../fighters/fighterData';
import { GROUND_Y, INSTALL_BODY_SCALE } from '../sim/constants';
import type { SimFighter } from '../sim/types';
import { chargeLevel, isChargeSpecId } from '../fighters/chargeSpecials';
import { getSpec } from '../sim/attackSpecs';
import { chargeTextureKey, poseTextureKey, releaseTextureKey, type PoseName } from '../fighters/poseSheet';
import { ultimateVisualsFor } from '../fighters/ultimateVisuals';
import { INSTALL_ATTACHMENTS, installCellFor } from '../fighters/installPoses';

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
  /** The texture key currently shown, so a redundant swap can be skipped. */
  private currentKey = '';
  private baseScale = 1;
  private wasGrounded = true;
  /** Weapons mounted on a transformed body. Empty for everyone but blade. */
  private attachments: Phaser.GameObjects.Image[] = [];

  constructor(private readonly scene: Phaser.Scene, fighter: SimFighter) {
    const art = artFor(fighter);
    this.sprite = scene.add.image(fighter.x, fighter.y, art.key).setOrigin(0.5, 1);
    this.currentKey = art.key;
    this.normalizeVisual(art.size);
  }

  /** Reset for a new round: the sprite may be mid-KO-tint from the last one. */
  reset(): void {
    this.sprite.setVisible(true).setAlpha(1).clearTint().setRotation(0);
    this.wasGrounded = true;
    this.currentKey = '';
    // A round can end mid-transformation, and the next one starts untransformed.
    for (const sprite of this.attachments) sprite.destroy();
    this.attachments = [];
  }

  sync(fighter: SimFighter, nowMs: number): void {
    const grounded = fighter.y >= GROUND_Y - 1;
    if (!this.wasGrounded && grounded && fighter.state !== FighterState.KO) {
      this.squashOnLanding();
    }
    this.wasGrounded = grounded;

    this.show(artFor(fighter));
    this.applyTransform(fighter, nowMs);
    this.trailAfterimage(fighter);
  }

  /**
   * Leave a fading copy behind, for moves that declare an afterimage.
   *
   * Every other tick rather than every one: at 60 Hz a copy per tick is a solid
   * smear rather than a trail, and half the objects read better and cost less. The
   * ghosts are plain sprites that tween themselves out and self-destruct, so there
   * is nothing to track and nothing to clean up if the round ends mid-dash.
   */
  private trailAfterimage(fighter: SimFighter): void {
    const attack = fighter.attack;
    if (!attack || !getSpec(attack.specId).afterimage) return;
    if (attack.elapsedTicks % 2 !== 0) return;

    const ghost = this.scene.add
      .image(this.sprite.x, this.sprite.y, this.sprite.texture.key)
      .setOrigin(0.5, 1)
      .setScale(this.sprite.scaleX, this.sprite.scaleY)
      .setFlipX(this.sprite.flipX)
      .setDepth(this.sprite.depth - 1)
      .setAlpha(0.45)
      .setTint(paletteFor(fighter).accent);

    this.scene.tweens.add({
      targets: ghost,
      alpha: 0,
      duration: 220,
      onComplete: () => ghost.destroy(),
    });
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

  private show(art: FighterArt): void {
    if (this.currentKey === art.key) return;
    this.currentKey = art.key;
    this.sprite.setTexture(art.key);
    this.normalizeVisual(art.size);
  }

  /**
   * Fit the sprite to its size class.
   *
   * Every source image is a different shape — poses, skill cells and the ultimate
   * frame all come out of different sheets — so the sprite is fitted to a box rather
   * than given a scale. Without it a fighter changes size when it changes pose.
   */
  private normalizeVisual(size: SizeClass): void {
    const texture = this.sprite.texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const box = SIZE_BOXES[size];
    this.baseScale = Math.min(
      box.height / Math.max(1, texture.height),
      box.width / Math.max(1, texture.width),
    );
    this.sprite.setScale(this.baseScale);
    this.sprite.setOrigin(0.5, 1);
  }

  /**
   * The scale everything else is written against.
   *
   * A transformation makes the fighter physically twice the size, and the
   * simulation's hurtbox is doubled to match — see `INSTALL_BODY_SCALE`. Doing it
   * here rather than at each `setScale` call means the wobble, the landing squash
   * and the crouch flatten all keep working, in proportion, on a body twice as
   * big. The sprite is bottom-anchored, so growing it leaves the feet on the
   * floor.
   */
  private displayScale(fighter: SimFighter): number {
    return fighter.installTicks > 0 ? this.baseScale * INSTALL_BODY_SCALE : this.baseScale;
  }

  private applyTransform(fighter: SimFighter, nowMs: number): void {
    this.sprite.setPosition(fighter.x, fighter.y).setFlipX(fighter.facing < 0);
    this.syncAttachments(fighter);
    const airborne = fighter.y < GROUND_Y - 1;

    const scale = this.displayScale(fighter);

    if (fighter.state === FighterState.IDLE && !airborne) {
      const wave = Math.sin(nowMs / 190) * 0.012;
      this.sprite.setScale(scale, scale * (1 + wave));
      this.sprite.setRotation(Math.sin(nowMs / 420) * 0.01 * fighter.facing);
    } else if (fighter.state === FighterState.WALK) {
      this.sprite.setScale(scale);
      this.sprite.setRotation(Math.sin(nowMs / 70) * 0.025);
    } else if (fighter.state === FighterState.JUMP) {
      this.sprite.setScale(scale, scale * 1.04);
      this.sprite.setRotation(fighter.facing * 0.035);
    } else {
      if (fighter.attack?.crouching) {
        this.sprite.setScale(scale * 1.06, scale * 0.8);
      } else if (!fighter.attack) {
        this.sprite.setScale(scale);
      }
      this.sprite.setRotation(0);
    }
  }

  /**
   * The two swords blade carries once the shield is gone.
   *
   * Created on demand and destroyed the moment the install ends, rather than kept
   * hidden: they exist for eight seconds of a match and nothing else in the view
   * needs to know about them. They hang off the transformed body's sockets, which
   * is why the offset is scaled with it.
   *
   * `INSTALL_ATTACHMENTS` has one entry, and the loop is still a loop, because a
   * socket count is exactly the kind of thing a second fighter would want.
   */
  private syncAttachments(fighter: SimFighter): void {
    const wanted = fighter.installTicks > 0 ? (INSTALL_ATTACHMENTS[fighter.configId] ?? []) : [];

    if (wanted.length !== this.attachments.length) {
      for (const sprite of this.attachments) sprite.destroy();
      this.attachments = wanted
        .map((cell) => `skill-${fighter.configId}-${cell.toLowerCase()}`)
        .filter((key) => this.scene.textures.exists(key))
        .map((key) => this.scene.add.image(fighter.x, fighter.y, key).setOrigin(0.5, 0.5));
      for (const sprite of this.attachments) this.sprite.parentContainer?.add(sprite);
    }
    if (this.attachments.length === 0) return;

    const scale = this.displayScale(fighter);
    this.attachments.forEach((sprite, index) => {
      // One socket either side of the body, at about waist height on the
      // transformed frame.
      const side = index === 0 ? -1 : 1;
      sprite
        .setPosition(fighter.x + side * SOCKET_OFFSET_X * scale, fighter.y - SOCKET_HEIGHT * scale)
        .setFlipX(fighter.facing < 0)
        .setDepth(this.sprite.depth + (side === 1 ? 1 : -1))
        .setScale(scale * SOCKET_SCALE);
    });
  }
}

/**
 * Where a mounted weapon sits on a transformed body, in untransformed pixels.
 *
 * Multiplied by the display scale at use, so the swords stay on the hands rather
 * than drifting toward the middle when the body doubles.
 */
const SOCKET_OFFSET_X = 46;
const SOCKET_HEIGHT = 96;
const SOCKET_SCALE = 0.78;

/**
 * How large a given kind of art is allowed to draw.
 *
 * Named classes rather than a number per pose, because the distinction is about
 * what the frame *is* — a fighter, a downed fighter, a full ultimate — and three
 * sheets with different framing all have to land at the same apparent size.
 */
type SizeClass = 'fighter' | 'downed' | 'ultimate';

const SIZE_BOXES: Record<SizeClass, { width: number; height: number }> = {
  fighter: { width: 330, height: 250 },
  downed: { width: 330, height: 270 },
  ultimate: { width: 520, height: 330 },
};

interface FighterArt {
  key: string;
  size: SizeClass;
}

/**
 * Which frame to draw, derived purely from simulation state.
 *
 * The charge branches come first because they are the only ones that read anything
 * other than `state`: a winding-up fighter shows the wind-up frame for the level it
 * has actually reached, which is the only way a player can tell a level 2 from a
 * level 3 before letting go.
 */
export function artFor(fighter: SimFighter): FighterArt {
  if (fighter.state === FighterState.H_CHARGING) {
    return {
      key: chargeTextureKey(fighter.configId, chargeLevel(fighter.chargeTicks)),
      size: 'fighter',
    };
  }
  // A released charge shows the release frame rather than the generic special pose.
  if (fighter.attack && isChargeSpecId(fighter.attack.specId)) {
    return { key: releaseTextureKey(fighter.configId), size: 'fighter' };
  }

  const pose = poseFor(fighter);
  /**
   * A transformation swaps the whole sheet, not just the colour.
   *
   * Four ultimates draw their owner a second time in a new body, one drawing per
   * pose. The lookup falls back to the ordinary sheet rather than demanding a
   * complete set, because the sets are not complete — doge was never drawn
   * guarding, and a missing key renders as a green box.
   *
   * **Ahead of the ultimate's own frame, and the order matters.** An install lands
   * at its timeline's peak — tick 54 for doge — while the `ULTIMATE` state runs to
   * tick 64, so the two overlap for ten ticks. Reading the ultimate first meant
   * the fighter stayed in its untransformed stance for a sixth of a second after
   * the beat that announced the transformation, which is the one moment the
   * transformation has to be legible.
   */
  if (fighter.installTicks > 0) {
    const cell = installCellFor(fighter.configId, pose);
    if (cell) {
      return {
        key: `skill-${fighter.configId}-${cell.toLowerCase()}`,
        size: pose === 'ko' || pose === 'victory' ? 'downed' : 'fighter',
      };
    }
  }
  /**
   * An ultimate holds its own frame off the skill sheet.
   *
   * The numbered pose sheet has one `ultimate` drawing per fighter, which was all
   * a one-tick super needed. These run for a hundred ticks with a scripted
   * presentation behind them, and the skill sheets were drawn for exactly that —
   * `ultimateVisuals` names which cell is the fighter mid-cast.
   */
  if (fighter.state === FighterState.ULTIMATE) {
    const cell = ultimateVisualsFor(fighter.configId).ownerCell;
    return { key: `skill-${fighter.configId}-${cell.toLowerCase()}`, size: 'ultimate' };
  }

  return {
    key: poseTextureKey(fighter.configId, pose),
    size:
      pose === 'ultimate' ? 'ultimate'
      : pose === 'ko' || pose === 'victory' ? 'downed'
      : 'fighter',
  };
}

/**
 * Pose is derived purely from simulation state.
 *
 * The original set some poses imperatively — `receiveImpact` wrote 'hit', 'block'
 * and 'ko' directly. Every one of those coincides with a state the simulation
 * already records, so deriving is equivalent and keeps the view stateless.
 */
/** Which of the three variants of a normal is on screen. */
function normalPose(fighter: SimFighter, strength: 'light' | 'heavy'): PoseName {
  const attack = fighter.attack;
  if (attack?.airborne) return strength === 'light' ? 'jumpLight' : 'jumpHeavy';
  if (attack?.crouching) return strength === 'light' ? 'crouchLight' : 'crouchHeavy';
  return strength;
}

export function poseFor(fighter: SimFighter): PoseName {
  switch (fighter.state) {
    case FighterState.KO:
      return 'ko';
    case FighterState.VICTORY:
      return 'victory';
    // Six normals, six poses. The stance is read off the attack rather than off
    // the fighter's state, because a crouching normal leaves the state as
    // LIGHT_ATTACK — the stance was decided when the move started and is frozen
    // on it, which is also what the hitbox is built from.
    case FighterState.LIGHT_ATTACK:
      return normalPose(fighter, 'light');
    case FighterState.HEAVY_ATTACK:
      return normalPose(fighter, 'heavy');
    case FighterState.SPECIAL:
      return 'special';
    case FighterState.ULTIMATE:
      return 'ultimate';
    case FighterState.THROW:
      return 'throw';
    case FighterState.MEME_IMPACT:
      return 'heavy';
    case FighterState.MEME_PARRY:
      return 'block';
    case FighterState.MEME_RUSH:
    case FighterState.DASH_FORWARD:
      return 'dashForward';
    case FighterState.DASH_BACK:
      return 'dashBack';
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
