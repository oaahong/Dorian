import * as Phaser from 'phaser';
import type { UltimateDefinition } from '../fighters/ultimateDefinitions';
import { FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';

/**
 * The staged announcement an ultimate gets: background, portrait, a shouted line
 * and a title card.
 *
 * Pure presentation — it draws, tweens and shakes, and never writes simulation
 * state. What keeps it in step is that the simulation freezes itself for exactly
 * `definition.cutInTicks`, and **this advances on those same ticks** rather than on
 * a wall clock.
 *
 * That distinction is the whole reason this class has a `sync` instead of a set of
 * `delayedCall`s. The fixed-step loop runs several ticks in one frame whenever the
 * client is behind — after a long paint, a background tab, a slow first load — so a
 * 1450 ms freeze can be consumed in a third of that in real time. Timed off the
 * clock, the cut-in was still fading in while the match had already resumed
 * underneath it. Keyed to the freeze it cannot drift, however badly the frame rate
 * behaves.
 *
 * Objects are built on `start` and destroyed when the freeze ends rather than
 * pooled: a cut-in happens at most twice a round, so the allocation is free at that
 * rate, and the alternative is a dozen live objects with state to reset.
 */

/**
 * Depth band reserved for the cut-in, above the HUD's 1005.
 *
 * The cut-in is the only thing that should be on screen while it runs — leaving the
 * health bars and the control hints over the top of it made the title card look like
 * a mistake.
 */
const DEPTH = 1100;

/**
 * The portrait is fitted to this rather than given a fixed scale.
 *
 * The skill-sheet cells it comes from run from 217x125 to 363x169 — a fixed scale
 * made some fighters twice the size of others, and all of them small enough to lose
 * against a busy background. Fitting to a target height with a width cap gives every
 * fighter the same presence whatever shape its cell happens to be.
 */
const PORTRAIT_HEIGHT = 360;
const PORTRAIT_MAX_WIDTH = 520;

/** Beats, in ticks from the start of the freeze. */
const PORTRAIT_IN_TICKS = 13;
const TITLE_IN_TICKS = 23;
/** How long before the end the whole thing starts winding back out. */
const EXIT_TICKS = 14;

/** How long after the title card a transformation is announced. */
const PEAK_DELAY_TICKS = 10;

/** The two whose ultimate is a signal breaking down, and stutters to say so. */
const GLITCHING_FIGHTERS = new Set(['alien', 'pink']);

/** The four whose ultimate replaces the fighter with a different one. */
const INSTALL_FIGHTERS = new Set(['doge', 'goblin', 'blade', 'pink']);

export class UltimateCutIn {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private definition: UltimateDefinition | null = null;
  private totalTicks = 0;
  private elapsedTicks = -1;
  /** Which beats have already fired, so each happens once. */
  private fired = new Set<string>();

  private parts: {
    dark: Phaser.GameObjects.Rectangle;
    background: Phaser.GameObjects.Image;
    tint: Phaser.GameObjects.Rectangle;
    portrait: Phaser.GameObjects.Image;
    bubble: Phaser.GameObjects.Rectangle;
    tail: Phaser.GameObjects.Triangle;
    voice: Phaser.GameObjects.Text;
    title: Phaser.GameObjects.Text;
    flash: Phaser.GameObjects.Rectangle;
  } | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  get isActive(): boolean {
    return this.parts !== null;
  }

  private keep<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.objects.push(object);
    return object;
  }

  /**
   * Build the cut-in for `definition`.
   *
   * `side` is which half of the screen the fighter occupies, so the portrait and
   * the bubble sit apart and the tail always points at whoever is talking.
   */
  start(definition: UltimateDefinition, side: 0 | 1): void {
    this.stop();
    this.definition = definition;
    this.totalTicks = definition.cutInTicks;
    this.elapsedTicks = 0;
    this.fired.clear();

    const { style } = definition;
    const centreX = GAME_WIDTH / 2;
    const centreY = GAME_HEIGHT / 2;
    const portraitX = side === 0 ? 370 : GAME_WIDTH - 370;
    const bubbleX = side === 0 ? 760 : GAME_WIDTH - 760;
    const bubbleY = 230;

    const dark = this.keep(
      this.scene.add.rectangle(centreX, centreY, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0)
        .setDepth(DEPTH),
    );
    const background = this.keep(
      this.scene.add.image(centreX, centreY, definition.backgroundTexture)
        .setDepth(DEPTH + 1).setAlpha(0).setScale(1.05),
    );
    const tint = this.keep(
      this.scene.add.rectangle(centreX, centreY, GAME_WIDTH, GAME_HEIGHT, style.overlay, 0.22)
        .setDepth(DEPTH + 2).setAlpha(0),
    );
    const portrait = this.keep(
      this.scene.add.image(portraitX, GAME_HEIGHT - 40, definition.portraitTexture)
        .setOrigin(0.5, 1).setDepth(DEPTH + 3).setAlpha(0),
    );
    const source = portrait.texture.getSourceImage() as { width: number; height: number };
    portrait.setScale(
      Math.min(
        PORTRAIT_HEIGHT / Math.max(1, source.height),
        PORTRAIT_MAX_WIDTH / Math.max(1, source.width),
      ),
    );
    const bubble = this.keep(
      this.scene.add.rectangle(bubbleX, bubbleY, 540, 118, style.bubble, 0.96)
        .setStrokeStyle(6, Phaser.Display.Color.HexStringToColor(style.ink).color, 1)
        .setDepth(DEPTH + 4).setScale(0),
    );
    const tailX = side === 0 ? bubbleX - 245 : bubbleX + 245;
    const tailWidth = side === 0 ? 58 : -58;
    const tail = this.keep(
      this.scene.add.triangle(tailX, bubbleY + 66, 0, 0, tailWidth, 0, 0, 58, style.bubble, 0.96)
        .setDepth(DEPTH + 4).setScale(0),
    );
    const voice = this.keep(
      this.scene.add.text(bubbleX, bubbleY, definition.voiceText, {
        fontFamily: FONT_FAMILY,
        // Long lines step down a size rather than spilling to a third row.
        fontSize: definition.voiceText.length > 20 ? '27px' : '33px',
        color: style.ink,
        stroke: '#000000',
        strokeThickness: style.ink === '#ffffff' ? 4 : 0,
        align: 'center',
        wordWrap: { width: 500 },
      }).setOrigin(0.5).setDepth(DEPTH + 5).setAlpha(0),
    );
    const title = this.keep(
      this.scene.add.text(centreX, 570, definition.ultimateName, {
        fontFamily: FONT_FAMILY,
        fontSize: '66px',
        color: style.title,
        stroke: '#000000',
        strokeThickness: 10,
        align: 'center',
      }).setOrigin(0.5).setDepth(DEPTH + 6).setAlpha(0).setScale(1.6),
    );
    const flash = this.keep(
      this.scene.add.rectangle(centreX, centreY, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 1)
        .setDepth(DEPTH + 7).setAlpha(0),
    );

    this.parts = { dark, background, tint, portrait, bubble, tail, voice, title, flash };

    // The entrance is short enough that a tween cannot outlive its beat, so these
    // stay as tweens for the easing.
    this.scene.tweens.add({ targets: dark, alpha: 0.66, duration: 90 });
    this.scene.tweens.add({ targets: background, alpha: 1, scale: 1, duration: 180, ease: 'Quad.easeOut' });
    this.scene.tweens.add({ targets: tint, alpha: 0.22, duration: 180 });
    this.scene.tweens.add({
      targets: portrait,
      alpha: 1,
      x: side === 0 ? 420 : GAME_WIDTH - 420,
      duration: 210,
      ease: 'Back.easeOut',
    });
  }

  /**
   * Advance the cut-in to match the freeze that is driving it.
   *
   * `remainingFreezeTicks` is the simulation's own countdown, so this asks how far
   * through the freeze the match actually is rather than how much time has passed.
   */
  sync(remainingFreezeTicks: number): void {
    const parts = this.parts;
    const definition = this.definition;
    if (!parts || !definition) return;

    this.elapsedTicks = this.totalTicks - remainingFreezeTicks;

    if (this.at('portrait', PORTRAIT_IN_TICKS)) {
      this.scene.tweens.add({
        targets: [parts.bubble, parts.tail],
        scale: 1.15,
        duration: 80,
        yoyo: true,
        onComplete: () => { parts.bubble.setScale(1); parts.tail.setScale(1); },
      });
      parts.voice.setAlpha(1);
    }

    if (this.at('title', TITLE_IN_TICKS)) {
      parts.title.setAlpha(1);
      this.scene.tweens.add({ targets: parts.title, scale: 1, duration: 190, ease: 'Back.easeOut' });
      this.scene.cameras.main.shake(110, definition.style.shake);
      parts.flash.setAlpha(0.7);
      this.scene.tweens.add({ targets: parts.flash, alpha: 0, duration: 100 });

      /**
       * A horizontal tear on the two fighters whose ultimate is a broken signal.
       *
       * alien is literally a transmission failing and pink's is a mask coming
       * off under distortion, so the background stutters sideways for a moment
       * rather than sitting still behind the title. It is eight pixels and it is
       * the difference between a cut-in and a poster.
       */
      if (GLITCHING_FIGHTERS.has(definition.fighterId)) {
        this.scene.tweens.add({
          targets: parts.background,
          x: { from: GAME_WIDTH / 2 - 4, to: GAME_WIDTH / 2 + 4 },
          yoyo: true,
          repeat: 5,
          duration: 35,
        });
      }
    }

    /**
     * The moment a transformation actually lands.
     *
     * Only the four install ultimates get it, and only they should: it is the
     * beat where the fighter stops being the one on the character-select screen.
     * Without it the cut-in ends and a differently-shaped fighter is simply
     * standing there.
     */
    if (INSTALL_FIGHTERS.has(definition.fighterId) && this.at('peak', TITLE_IN_TICKS + PEAK_DELAY_TICKS)) {
      const peak = this.keep(
        this.scene.add
          .text(GAME_WIDTH / 2, 470, 'TRANSFORMATION PEAK', {
            fontFamily: FONT_FAMILY,
            fontSize: '30px',
            color: definition.style.title,
            stroke: '#050505',
            strokeThickness: 8,
          })
          .setOrigin(0.5)
          .setDepth(DEPTH + 6)
          .setAlpha(0),
      );
      this.scene.tweens.add({ targets: peak, alpha: 1, y: 440, duration: 220, yoyo: true, hold: 180 });
    }

    // Wind out before the freeze lifts, so control returns on a clear screen rather
    // than under a backdrop still fading.
    if (this.at('exit', Math.max(TITLE_IN_TICKS + 6, this.totalTicks - EXIT_TICKS))) {
      parts.flash.setAlpha(0.72);
      this.scene.tweens.add({
        targets: [parts.background, parts.portrait, parts.bubble, parts.tail, parts.voice, parts.title, parts.tint, parts.dark],
        alpha: 0,
        duration: 190,
      });
      this.scene.tweens.add({ targets: parts.flash, alpha: 0, duration: 210 });
    }

    // The freeze is the cut-in's clock, so its end is the cut-in's end — including
    // when something else cut the freeze short.
    if (remainingFreezeTicks <= 0) this.stop();
  }

  /** Fire a beat once, the first time the freeze has reached `tick`. */
  private at(name: string, tick: number): boolean {
    if (this.elapsedTicks < tick || this.fired.has(name)) return false;
    this.fired.add(name);
    return true;
  }

  /**
   * Tear the cut-in down.
   *
   * Safe at any point and more than once: a round can end, or the scene be left,
   * in the middle of one.
   */
  stop(): void {
    for (const object of this.objects) {
      this.scene.tweens.killTweensOf(object);
      object.destroy();
    }
    this.objects = [];
    if (this.parts) this.scene.cameras.main.resetFX();
    this.parts = null;
    this.definition = null;
    this.elapsedTicks = -1;
    this.fired.clear();
  }
}
