/**
 * Where the menu screens put things, as arithmetic rather than as coordinates
 * typed into each scene.
 *
 * Both bugs this file exists to prevent were the same bug: a screen grew, and the
 * numbers below the thing that grew stayed where they were. `MODES` went from
 * three entries to four when training mode landed, and the CPU-difficulty line —
 * written as a bare `530` — ended up drawn on top of the fourth option. The
 * detail panel's stat block grew a row, and the tagline underneath it kept the
 * y it had when the block was shorter, leaving 8px where a line of text needs 23.
 *
 * So the rule here is that anything sitting *under* something else derives its
 * position from that thing's extent. Adding a fifth mode moves the difficulty and
 * help lines on its own; it cannot silently overlap them.
 *
 * No Phaser import, deliberately: `vitest.config.ts` runs unit tests in a node
 * environment and treats a need for jsdom as a leak to be fixed rather than
 * configured around. Keeping the arithmetic here means it is testable for the
 * price of a normal unit test, and the scenes are left holding only Phaser calls.
 */

import { GAME_HEIGHT } from '../sim/constants';

// --- Mode select ------------------------------------------------------------

/**
 * How tall one option renders, including its padding and the 1.08x swell the
 * selected entry gets.
 *
 * Measured from the real text objects rather than derived from the font size:
 * "Arial Black" at 38px with `padding: { y: 10 }` boxes out at 69px, and the
 * selected one at 75px. Rounded up to 76 so the gaps below are honest about the
 * worst case, which is the case that actually collided.
 */
export const MODE_OPTION_HEIGHT = 76;

const MODE_MENU = {
  /** Centre of the first option. Clears the SELECT MODE chrome, which ends at y=130. */
  firstOptionY: 232,
  /** Centre-to-centre. Leaves 8px between two selected-size boxes. */
  optionStep: 84,
  /** From the last option's centre to the difficulty line's centre. */
  difficultyGap: 92,
  /** From the difficulty line's centre to the help line's centre. */
  helpGap: 66,
} as const;

export interface ModeMenuLayout {
  /** Centre y of option `index`. */
  optionY: (index: number) => number;
  /** Centre y of the CPU-difficulty line. */
  difficultyY: number;
  /** Centre y of the controls help line. */
  helpY: number;
  /** Bottom edge of the last option at its selected size. */
  optionsBottom: number;
}

/**
 * The mode menu's vertical stack, for a menu of `optionCount` entries.
 *
 * Callers pass the count instead of this module importing `MODES`, so that the
 * layout stays free of the scene — and so the test can ask what a five- or
 * six-entry menu would look like without inventing fake modes.
 */
export const modeMenuLayout = (optionCount: number): ModeMenuLayout => {
  const optionY = (index: number) => MODE_MENU.firstOptionY + index * MODE_MENU.optionStep;
  const lastOptionY = optionY(optionCount - 1);
  const difficultyY = lastOptionY + MODE_MENU.difficultyGap;
  return {
    optionY,
    difficultyY,
    helpY: difficultyY + MODE_MENU.helpGap,
    optionsBottom: lastOptionY + MODE_OPTION_HEIGHT / 2,
  };
};

// --- Character select detail panel ------------------------------------------

/**
 * The panel on the right of character select. Everything inside it is positioned
 * from these four numbers, so the panel can be moved or resized in one place.
 */
export const DETAIL_PANEL = {
  centerX: 972,
  width: 470,
  top: 48,
  bottom: 668,
  /** Inset from the panel's own edges to its text. */
  padX: 28,
} as const;

const panelLeft = DETAIL_PANEL.centerX - DETAIL_PANEL.width / 2;

/**
 * Card art keeps the thumbnails' own 476x596 aspect; stretching a fighter's card
 * to fill a differently-shaped box is the one distortion the low-res art style
 * does not excuse.
 */
const CARD_ASPECT = 476 / 596;
const cardHeight = 238;

const contentLeft = panelLeft + DETAIL_PANEL.padX;
const contentWidth = DETAIL_PANEL.width - DETAIL_PANEL.padX * 2;
const cardTop = DETAIL_PANEL.top + 23;
const statsTop = cardTop + cardHeight + 21;

/**
 * Height reserved for the eleven-line stat block at 17px with 5px of line
 * spacing. Phaser measures ~23.3px per line; 256 is what the real object reports
 * and what the layout is checked against.
 */
const STATS_HEIGHT = 256;

const dividerY = statsTop + STATS_HEIGHT + 16;

export const DETAIL_LAYOUT = {
  /** The panel rectangle itself, in Phaser's centre-origin form. */
  panel: {
    x: DETAIL_PANEL.centerX,
    y: (DETAIL_PANEL.top + DETAIL_PANEL.bottom) / 2,
    width: DETAIL_PANEL.width,
    height: DETAIL_PANEL.bottom - DETAIL_PANEL.top,
  },
  /** Card art, centred on the panel — it used to sit at x=950, 22px off-centre. */
  card: {
    x: DETAIL_PANEL.centerX,
    y: cardTop + cardHeight / 2,
    width: Math.round(cardHeight * CARD_ASPECT),
    height: cardHeight,
  },
  /** Top-left of the stat block, and the width its lines may wrap within. */
  stats: { x: contentLeft, y: statsTop, wrapWidth: contentWidth },
  /** A rule separating the stats from the tagline, so the tagline is not read as a twelfth stat. */
  divider: { x: DETAIL_PANEL.centerX, y: dividerY, width: contentWidth },
  /**
   * The tagline band. `maxLines` is the hard guarantee: today's twelve taglines
   * all happen to fit on one line, which is why the 8px gap went unnoticed, and
   * "happens to fit" is not a layout.
   */
  tagline: { x: contentLeft, y: dividerY + 14, wrapWidth: contentWidth, maxLines: 2, lineHeight: 20 },
  /** Controls help, below the panel. */
  helpY: 698,
} as const;

/** Bottom edge of the tagline when it uses every line it is allowed. */
export const TAGLINE_MAX_BOTTOM =
  DETAIL_LAYOUT.tagline.y + DETAIL_LAYOUT.tagline.maxLines * DETAIL_LAYOUT.tagline.lineHeight;

/** Bottom edge of the stat block at its full eleven lines. */
export const STATS_BOTTOM = statsTop + STATS_HEIGHT;

/** The logical stage height everything above must stay inside. */
export const STAGE_HEIGHT = GAME_HEIGHT;
