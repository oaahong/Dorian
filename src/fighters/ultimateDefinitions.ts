import { TICK_HZ } from '../sim/constants';
import { getFighterConfig } from './fighterData';

/**
 * The staged presentation each ultimate gets: a background, a portrait, a line of
 * dialogue and a title card.
 *
 * **The duration lives here, in ticks, because the simulation freezes for it.**
 * That is the load-bearing detail. A cut-in that only paused rendering would drift
 * the two clients apart the moment one of them dropped a frame, so the freeze is
 * part of the simulation — the same mechanism as hit-stop — and its length has to
 * be something both machines compute identically from data they both have. It is
 * derived from the length of the voice line, clamped per fighter, and resolved to a
 * whole number of ticks once at module load. Nothing about it is measured.
 *
 * Everything else in here is presentation and never reaches the simulation.
 */

/** The palette a cut-in is staged in. */
export interface CutInStyle {
  /** Full-screen tint over the background. */
  overlay: number;
  /** Title card colour. */
  title: string;
  /** Speech bubble fill. */
  bubble: number;
  /** Bubble text and outline colour — dark for the one white-on-white fighter. */
  ink: string;
  /** Camera shake intensity. */
  shake: number;
}

export interface UltimateDefinition {
  fighterId: string;
  /**
   * The player-visible name, taken from the roster rather than restated here.
   *
   * It is on the AttackSpec because the HUD and the select screen read it there
   * generically, alongside every other move's name. Writing it out a second time in
   * this file was a drift waiting to happen — two strings, one of them wrong,
   * nothing to notice.
   */
  ultimateName: string;
  /** What the fighter shouts. Its length decides the cut-in's length. */
  voiceText: string;
  /** `public/assets/ultimate-backgrounds/<id>.png`, as `ultimate-bg-<id>`. */
  backgroundTexture: string;
  /**
   * Which cell of the fighter's skill sheet is the cut-in portrait.
   *
   * Always `D`, the cell the asset pipeline categorises as `H_RELEASE_FIGHTER` —
   * the fighter mid-release, which is the most dramatic pose of it that is
   * guaranteed to *be* the fighter. The upgraded build named a different letter per
   * fighter, but those pointed into the `ULTIMATE_MODULE` range, which is a mix of
   * characters and standalone effect layers it composited together. Picking one of
   * those to show alone got alien a beam with no cat attached.
   */
  portraitTexture: string;
  style: CutInStyle;
  /** How long the whole cut-in runs, and how long the simulation is frozen. */
  cutInTicks: number;
}

/** Reading time, before clamping: a base beat plus a beat per character. */
const BASE_MS = 900;
const MS_PER_CHARACTER = 32;

/**
 * Resolved once, at module load, with integer arithmetic only.
 *
 * `Math.round` on a value both clients compute from the same string length is
 * safe; a measured duration would not be.
 */
const cutInTicks = (voiceText: string, minMs: number, maxMs: number): number => {
  const ms = Math.min(Math.max(BASE_MS + voiceText.length * MS_PER_CHARACTER, minMs), maxMs);
  return Math.round((ms * TICK_HZ) / 1000);
};

const define = (
  fighterId: string,
  voiceText: string,
  portraitCell: string,
  style: CutInStyle,
  minMs = 1450,
  maxMs = 2050,
): UltimateDefinition => ({
  fighterId,
  ultimateName: getFighterConfig(fighterId).ultimate.name,
  voiceText,
  backgroundTexture: `ultimate-bg-${fighterId}`,
  portraitTexture: `skill-${fighterId}-${portraitCell.toLowerCase()}`,
  style,
  cutInTicks: cutInTicks(voiceText, minMs, maxMs),
});

export const ULTIMATE_DEFINITIONS: Record<string, UltimateDefinition> = {
  alien: define('alien', '逼逼逼——地球——鎖定喵！', 'D', {
    overlay: 0x071a0b, title: '#63ff7e', bubble: 0x102f18, ink: '#ffffff', shake: 0.008,
  }),
  doge: define('doge', '你是說克林嗎!!!!!', 'D', {
    overlay: 0x4a3900, title: '#ffe34f', bubble: 0x3c3000, ink: '#ffffff', shake: 0.012,
  }),
  ya: define('ya', '等、等一下……不要拍啦！哈ㄗ咖西...', 'D', {
    overlay: 0x392536, title: '#ffb6e7', bubble: 0xffffff, ink: '#2a1424', shake: 0.006,
  }, 1750, 2200),
  tempura: define('tempura', 'oh fucking 天婦羅尬哩涼！', 'D', {
    // The one fighter staged on white, so its ink and bubble outline invert.
    overlay: 0xffffff, title: '#111111', bubble: 0xffffff, ink: '#111111', shake: 0.014,
  }),
  goblin: define('goblin', '犧牲哥布林長老十年的壽命...變帥吧！！', 'D', {
    overlay: 0x451a40, title: '#ff9de1', bubble: 0xffd7f1, ink: '#3c0f33', shake: 0.008,
  }, 1800, 2200),
  salad: define('salad', '菜就多練啊！！', 'D', {
    overlay: 0x283813, title: '#dfff6e', bubble: 0xf3ffd4, ink: '#22300f', shake: 0.014,
  }),
  wizard: define('wizard', '偉大的喵蘇魯呀——出來吃飯啦！', 'D', {
    overlay: 0x170b28, title: '#c778ff', bubble: 0x221337, ink: '#ffffff', shake: 0.009,
  }, 1750, 2150),
  blade: define('blade', '盾？不要了！幫我撐十秒！！', 'D', {
    overlay: 0x101b2b, title: '#79c9ff', bubble: 0x17263b, ink: '#ffffff', shake: 0.012,
  }),
  pink: define('pink', '不！我怪人的真面目要被看光光了！！', 'D', {
    overlay: 0x3c0c2a, title: '#ff70c6', bubble: 0xffd3ec, ink: '#3a0a26', shake: 0.014,
  }, 1750, 2150),
  sauce: define('sauce', '這不是胡渣！NTMD', 'D', {
    overlay: 0x382314, title: '#f0bd79', bubble: 0x6b432b, ink: '#ffffff', shake: 0.013,
  }),
  scared: define('scared', '那...那不是夢....那是真狗！！', 'D', {
    overlay: 0x07172a, title: '#9ed7ff', bubble: 0xeaf7ff, ink: '#0b2035', shake: 0.012,
  }),
  ok: define('ok', '兄弟們！站著把錢給我掙了！！', 'D', {
    overlay: 0x0c0c0c, title: '#e7b74c', bubble: 0x171717, ink: '#ffffff', shake: 0.013,
  }),
};

export function ultimateDefinitionFor(fighterId: string): UltimateDefinition {
  const found = ULTIMATE_DEFINITIONS[fighterId];
  if (!found) throw new Error(`No ultimate definition for fighter: ${fighterId}`);
  return found;
}
