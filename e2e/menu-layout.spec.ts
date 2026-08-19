import { test, expect, type Page } from '@playwright/test';
import { FIGHTERS } from '../src/fighters/fighterData';
import { DETAIL_PANEL } from '../src/ui/menuLayout';
import { BOOT_TIMEOUT_MS, pressAfterInputUnlock, waitForScene } from './helpers';

/**
 * Layout regressions the unit tests cannot see.
 *
 * `src/ui/__tests__/menuLayout.test.ts` proves the arithmetic is self-consistent,
 * but it assumes a stat block of a certain height. What actually collided on the
 * character-select panel was the *measured* height of eleven rendered lines of
 * "Arial Black" against a tagline placed 8px below where they ended — and only a
 * browser knows what a font measures. So these read `getBounds()` off the live
 * game objects.
 */

interface Box { x: number; y: number; right: number; bottom: number }

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

/** Bounds of every Text object in a scene, keyed by a prefix of its content. */
async function textBoxes(page: Page, sceneKey: string): Promise<{ text: string; box: Box }[]> {
  return page.evaluate((key) => {
    const scene = window.__MEME_CAT_GAME__!.scene.getScene(key) as unknown as {
      children: { list: { type: string; text?: string; getBounds: () => Box }[] };
    };
    return scene.children.list
      .filter((o) => o.type === 'Text')
      .map((o) => {
        const b = o.getBounds();
        return { text: String(o.text ?? ''), box: { x: b.x, y: b.y, right: b.right, bottom: b.bottom } };
      });
  }, sceneKey);
}

/** Bounds of the two detail-panel texts, whichever fighter is currently focused. */
async function panelBoxes(page: Page): Promise<{ stats: Box; tagline: Box; tagText: string }> {
  return page.evaluate(() => {
    const scene = window.__MEME_CAT_GAME__!.scene.getScene('CharacterSelectScene') as unknown as {
      detailText: { getBounds: () => Box };
      taglineText: { getBounds: () => Box; text: string };
    };
    const box = (b: Box) => ({ x: b.x, y: b.y, right: b.right, bottom: b.bottom });
    return {
      stats: box(scene.detailText.getBounds()),
      tagline: box(scene.taglineText.getBounds()),
      tagText: scene.taglineText.text,
    };
  });
}

test('the mode menu keeps the difficulty and help lines off the options', async ({ page }) => {
  await page.goto('/');
  await waitForScene(page, 'TitleScene', BOOT_TIMEOUT_MS);
  await page.keyboard.press('Space');
  await waitForScene(page, 'ModeSelectScene');
  await page.waitForTimeout(450);

  /**
   * Checked once per option, because the selected entry renders 1.08x larger
   * than the rest. TRAINING is the one that broke: adding it as a fourth mode
   * put its box at y 491-559 while the difficulty line sat at 518-542, drawn
   * straight over it.
   */
  for (let i = 0; i < 4; i += 1) {
    const texts = await textBoxes(page, 'ModeSelectScene');
    const difficulty = texts.find((t) => t.text.startsWith('CPU DIFFICULTY'))!;
    const help = texts.find((t) => t.text.includes(': SELECT'))!;
    const options = texts.filter((t) => /VS|TRAINING/.test(t.text) && t !== difficulty);

    expect(options, 'all four modes should be on screen').toHaveLength(4);
    for (const option of options) {
      expect(
        overlaps(option.box, difficulty.box),
        `"${option.text.trim()}" overlaps the difficulty line`,
      ).toBe(false);
      expect(overlaps(option.box, help.box), `"${option.text.trim()}" overlaps the help line`).toBe(false);
    }
    expect(overlaps(difficulty.box, help.box)).toBe(false);
    expect(help.box.bottom).toBeLessThan(720);

    await page.keyboard.press('s');
    await page.waitForTimeout(90);
  }
});

test('the character-select detail panel contains every fighters text', async ({ page }) => {
  await page.goto('/');
  await waitForScene(page, 'TitleScene', BOOT_TIMEOUT_MS);
  await page.keyboard.press('Space');
  await waitForScene(page, 'ModeSelectScene');
  await pressAfterInputUnlock(page, 's');          // 1P VS CPU -> 2P VS P2
  await page.waitForTimeout(120);
  await page.keyboard.press('f');
  await waitForScene(page, 'CharacterSelectScene');
  await page.waitForTimeout(450);

  const help = (await textBoxes(page, 'CharacterSelectScene')).find((t) => t.text.includes('ESC BACK'))!;
  const panelLeft = DETAIL_PANEL.centerX - DETAIL_PANEL.width / 2;
  const panelRight = DETAIL_PANEL.centerX + DETAIL_PANEL.width / 2;

  /**
   * Walked with the keyboard rather than by poking `p1.index`, so this exercises
   * the same path a player does. The grid wraps, so twelve presses of 'd' visit
   * every fighter in turn.
   */
  for (let i = 0; i < FIGHTERS.length; i += 1) {
    const { stats, tagline, tagText } = await panelBoxes(page);
    const who = FIGHTERS[i]!.shortName;

    expect(stats.y, `${who}: stats above the panel`).toBeGreaterThanOrEqual(DETAIL_PANEL.top);
    expect(stats.right, `${who}: stats past the panel edge`).toBeLessThanOrEqual(panelRight);
    expect(stats.x, `${who}: stats left of the panel`).toBeGreaterThanOrEqual(panelLeft);

    expect(tagline.bottom, `${who}: tagline "${tagText}" runs out of the panel`)
      .toBeLessThanOrEqual(DETAIL_PANEL.bottom);
    expect(tagline.right, `${who}: tagline past the panel edge`).toBeLessThanOrEqual(panelRight);

    // The failure that prompted all this: 8px between these two, where a line of
    // this text is 23px tall.
    expect(overlaps(stats, tagline), `${who}: stats and tagline collide`).toBe(false);
    expect(tagline.y - stats.bottom, `${who}: stats and tagline are too close to read apart`)
      .toBeGreaterThan(20);

    expect(overlaps(tagline, help.box), `${who}: tagline collides with the controls line`).toBe(false);

    await page.keyboard.press('d');
    await page.waitForTimeout(80);
  }
});
