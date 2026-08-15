import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import {
  activeSceneKeys,
  readBattle,
  startCpuBattle,
  startVersusBattle,
  waitForFightPhase,
  waitForScene,
  pressAfterInputUnlock,
  BOOT_TIMEOUT_MS,
} from './helpers';

/**
 * These smoke tests are the safety net for the sim/render split. During that
 * refactor the unit tests only prove the new simulation layer is self-consistent;
 * these are the only tests that prove the actual game still boots, renders and
 * responds to keys.
 */

/** Collect console errors and uncaught exceptions for the lifetime of a page. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test('boots to the title screen without page errors', async ({ page }) => {
  const errors = collectPageErrors(page);

  await page.goto('/');
  await waitForScene(page, 'TitleScene', BOOT_TIMEOUT_MS);

  expect(await activeSceneKeys(page)).toContain('TitleScene');
  expect(errors).toEqual([]);
});

test('renders a canvas at the 1280x720 logical resolution', async ({ page }) => {
  await page.goto('/');
  await waitForScene(page, 'TitleScene', BOOT_TIMEOUT_MS);

  await expect(page.locator('#game-container canvas')).toHaveCount(1);

  // Phaser scales the canvas to fit the window, but the logical render size must
  // stay 1280x720 — every hitbox and arena constant is expressed in it.
  const size = await page.evaluate(() => {
    const game = window.__MEME_CAT_GAME__!;
    return { width: game.scale.width, height: game.scale.height };
  });
  expect(size).toEqual({ width: 1280, height: 720 });
});

test('extracts every combat pose for all eight fighters at boot', async ({ page }) => {
  await page.goto('/');
  await waitForScene(page, 'TitleScene', BOOT_TIMEOUT_MS);

  // SpriteExtractor registers one CanvasTexture per fighter per pose, keyed
  // `pose-<fighterId>-<pose>`. A failed extraction falls back to placeholder art
  // rather than throwing, so counting the textures is the only way to catch it.
  const poseTextureCount = await page.evaluate(() =>
    window.__MEME_CAT_GAME__!.textures.getTextureKeys().filter((key) => key.startsWith('pose-')).length,
  );
  expect(poseTextureCount).toBe(8 * 13);
});

test('navigates title -> mode select -> character select -> battle', async ({ page }) => {
  const errors = collectPageErrors(page);

  await page.goto('/');
  await startCpuBattle(page);

  expect(await activeSceneKeys(page)).toContain('BattleScene');
  expect(errors).toEqual([]);
});

test('a battle advances past the intro into the fight phase', async ({ page }) => {
  await page.goto('/');
  await startCpuBattle(page);

  // BattleScene holds an `intro` phase for ~1.12 s ("ROUND 1" / "CAT FIGHT!")
  // before handing control to the players.
  await waitForFightPhase(page);
});

test('both players can walk with their own keys in 2P mode', async ({ page }) => {
  await page.goto('/');
  await startVersusBattle(page);
  await waitForFightPhase(page);

  const before = await readBattle(page);

  // Regression guard. A `window` keydown listener registered before
  // `new Phaser.Game()` used to call preventDefault() on the arrow keys, and
  // Phaser drops any event whose defaultPrevented is already true — so Player 2
  // could not move, jump or crouch at all while Player 1 (letter keys) was fine.
  // The two seats are asserted together so a repeat of that asymmetry fails here.
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  const during = await readBattle(page);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('d');

  expect(during.p1.state, 'P1 should be walking').toBe('WALK');
  expect(during.p1.x, 'P1 should have moved right').toBeGreaterThan(before.p1.x);

  expect(during.p2.state, 'P2 should be walking').toBe('WALK');
  expect(during.p2.x, 'P2 should have moved left').toBeLessThan(before.p2.x);
});

test('an attack that connects actually deals damage', async ({ page }) => {
  /**
   * The end-to-end proof that the whole pipeline is wired: keyboard sampling ->
   * fixed-timestep stepWorld -> hit resolution -> state the view and HUD read.
   * Every layer can look healthy in isolation while the seam between two of them
   * is dead, and this is the test that would notice.
   */
  await page.goto('/');
  await startVersusBattle(page);
  await waitForFightPhase(page);

  // Walk P1 into P2 until they are actually in range, rather than walking for a
  // fixed wall-clock duration: how far a fixed duration carries the fighter
  // depends on frame timing, which made this flaky.
  await page.keyboard.down('d');
  await page.waitForFunction(
    () => {
      const w = (window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as {
        world: { fighters: [{ x: number }, { x: number }] };
      }).world;
      return Math.abs(w.fighters[1].x - w.fighters[0].x) < 120;
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.keyboard.up('d');

  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('f');
    await page.waitForTimeout(250);
  }

  const battle = await readBattle(page);
  expect(battle.p2.hp).toBeLessThan(100);
  expect(battle.tick).toBeGreaterThan(0);

  // The HUD is a separate consumer of the same state, so it can go stale without
  // any simulation test noticing. Compare what is actually drawn.
  const hud = await page.evaluate(() => {
    const scene = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as {
      world: { fighters: [{ energy: number }, { energy: number }] };
      children: { list: { type: string; text?: string }[] };
    };
    return {
      energies: [scene.world.fighters[0].energy, scene.world.fighters[1].energy],
      meters: scene.children.list
        .filter((o) => o.type === 'Text' && o.text?.startsWith('MEME'))
        .map((o) => o.text!),
    };
  });

  expect(hud.energies[0]).toBeGreaterThan(0);
  expect(hud.meters).toEqual([`MEME ${hud.energies[0]}`, `MEME ${hud.energies[1]}`]);
});

test('the simulation advances at roughly 60 ticks per second', async ({ page }) => {
  // A fixed timestep is the premise of the whole netcode plan; if the accumulator
  // is wrong the game still looks fine but runs at the wrong speed.
  await page.goto('/');
  await startVersusBattle(page);
  await waitForFightPhase(page);

  const before = await readBattle(page);
  await page.waitForTimeout(2000);
  const after = await readBattle(page);

  const ticksElapsed = after.tick - before.tick;
  expect(ticksElapsed).toBeGreaterThan(100); // >= ~50 ticks/s
  expect(ticksElapsed).toBeLessThan(140); // <= ~70 ticks/s
});

test('space works as a confirm key on the title screen', async ({ page }) => {
  // Space is in Phaser's capture list; captured keys must still reach the game.
  await page.goto('/');
  await waitForScene(page, 'TitleScene', BOOT_TIMEOUT_MS);

  await page.keyboard.press('Space');
  await waitForScene(page, 'ModeSelectScene');
});

test('escape pauses the battle and Q returns to the mode select', async ({ page }) => {
  await page.goto('/');
  await startCpuBattle(page);

  await pressAfterInputUnlock(page, 'Escape');
  await page.keyboard.press('q');

  await waitForScene(page, 'ModeSelectScene');
  expect(await activeSceneKeys(page)).toContain('ModeSelectScene');
});
