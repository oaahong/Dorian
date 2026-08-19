import { describe, expect, it } from 'vitest';
import {
  DETAIL_LAYOUT,
  DETAIL_PANEL,
  MODE_OPTION_HEIGHT,
  STAGE_HEIGHT,
  STATS_BOTTOM,
  TAGLINE_MAX_BOTTOM,
  modeMenuLayout,
} from '../menuLayout';

/**
 * These assert the arithmetic that the menus' hard-coded coordinates used to
 * stand in for. The bug they exist to catch is not subtle — the CPU-difficulty
 * line was drawn on top of the TRAINING option, hiding it — but it was invisible
 * to every test in the repo, because nothing tied the position of one element to
 * the extent of the one above it.
 */

describe('modeMenuLayout', () => {
  /**
   * Three is what the menu had before training mode; four is what it has now;
   * five and six are the next two times someone would have reintroduced the bug.
   * Checking a range rather than today's count is the whole point — the layout is
   * meant to absorb a new mode, not just survive the current one.
   */
  const counts = [3, 4, 5, 6];

  it.each(counts)('keeps the difficulty and help lines clear of a %i-option menu', (count) => {
    const layout = modeMenuLayout(count);
    const difficultyTop = layout.difficultyY - 12; // 22px line, centre origin
    const helpTop = layout.helpY - 10;             // 17px line, centre origin

    expect(layout.optionsBottom).toBeLessThan(difficultyTop);
    expect(layout.difficultyY + 12).toBeLessThan(helpTop);
  });

  it.each(counts)('gives every option in a %i-option menu its own band', (count) => {
    const layout = modeMenuLayout(count);
    for (let i = 1; i < count; i += 1) {
      const previousBottom = layout.optionY(i - 1) + MODE_OPTION_HEIGHT / 2;
      const top = layout.optionY(i) - MODE_OPTION_HEIGHT / 2;
      // Selected options swell to MODE_OPTION_HEIGHT, so this must hold at that
      // size for every entry, not only for the unselected ones.
      expect(previousBottom).toBeLessThan(top);
    }
  });

  it('fits a four-option menu on the stage, clear of the SELECT MODE chrome', () => {
    const layout = modeMenuLayout(4);
    // The chrome rectangle is 100px tall centred on y=80, so it ends at 130.
    expect(layout.optionY(0) - MODE_OPTION_HEIGHT / 2).toBeGreaterThan(130);
    expect(layout.helpY + 10).toBeLessThan(STAGE_HEIGHT);
  });

  it('moves the lines below the options down when the menu grows', () => {
    expect(modeMenuLayout(5).difficultyY).toBeGreaterThan(modeMenuLayout(4).difficultyY);
    expect(modeMenuLayout(5).helpY).toBeGreaterThan(modeMenuLayout(4).helpY);
  });
});

describe('DETAIL_LAYOUT', () => {
  it('stacks the card, stats, divider and tagline without overlap', () => {
    const cardBottom = DETAIL_LAYOUT.card.y + DETAIL_LAYOUT.card.height / 2;
    expect(cardBottom).toBeLessThan(DETAIL_LAYOUT.stats.y);
    expect(STATS_BOTTOM).toBeLessThan(DETAIL_LAYOUT.divider.y);
    expect(DETAIL_LAYOUT.divider.y).toBeLessThan(DETAIL_LAYOUT.tagline.y);
  });

  it('keeps everything inside the panel, tagline at its full height included', () => {
    const cardTop = DETAIL_LAYOUT.card.y - DETAIL_LAYOUT.card.height / 2;
    expect(cardTop).toBeGreaterThan(DETAIL_PANEL.top);
    // The old layout left 3px here, and only because no tagline happened to wrap.
    expect(TAGLINE_MAX_BOTTOM).toBeLessThan(DETAIL_PANEL.bottom);
  });

  it('leaves the controls line below the panel', () => {
    expect(DETAIL_LAYOUT.helpY - 8).toBeGreaterThan(DETAIL_PANEL.bottom);
    expect(DETAIL_LAYOUT.helpY + 8).toBeLessThan(STAGE_HEIGHT);
  });

  it('centres the card art on the panel and keeps the thumbnails aspect', () => {
    // It used to sit at x=950 against a panel centred on 972.
    expect(DETAIL_LAYOUT.card.x).toBe(DETAIL_PANEL.centerX);
    expect(DETAIL_LAYOUT.card.width / DETAIL_LAYOUT.card.height).toBeCloseTo(476 / 596, 2);
  });

  it('wraps text within the panels padding rather than past its edge', () => {
    const contentRight = DETAIL_LAYOUT.stats.x + DETAIL_LAYOUT.stats.wrapWidth;
    expect(contentRight).toBeLessThanOrEqual(DETAIL_PANEL.centerX + DETAIL_PANEL.width / 2);
  });
});
