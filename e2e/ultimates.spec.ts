import { test, expect } from '@playwright/test';
import { startVersusBattle, startVersusBattleAs, waitForFightPhase } from './helpers';

/**
 * The ultimates, in the actual game.
 *
 * Everything about how an ultimate looks is data — which cell on which tick,
 * which pose a transformed fighter holds — and all of that is covered without a
 * browser. What is *not* covered there is whether any of it reaches the screen:
 * whether the textures loaded, whether the stage is wired into the render loop,
 * whether the objects it creates are ever cleaned up.
 *
 * These are also the performance tests. The budgets are here rather than in a
 * separate spec because they are properties of the same run — an ultimate that
 * draws nothing passes a frame-budget test easily, and one that leaks passes an
 * "it drew something" test just as easily. Asserting both against one ultimate
 * means neither can be satisfied by failing the other.
 */

/** Live display objects an ultimate may have on screen at once. */
const MAX_ULTIMATE_OBJECTS = 40;
/**
 * How much of its ordinary tick rate the simulation must keep during an ultimate.
 *
 * A fraction of a baseline measured in the same session rather than a fixed 60:
 * headless Chromium throttles frame callbacks, so the absolute number says more
 * about the runner than about the game. The property being defended is that the
 * presentation does not cost the simulation its footing.
 */
const SLOWDOWN_ALLOWANCE = 0.85;

/**
 * The floor the simulation may not drop through while an ultimate is on screen.
 *
 * Deliberately not 60. This is a stall detector, not a frame-rate budget — see
 * the assertion for why the tight ratio lives on the recovery instead.
 */
const MIN_TICKS_PER_SECOND = 30;

/**
 * How long each tick-rate sample runs for.
 *
 * Three seconds, not one. The fixed-step accumulator runs several ticks in a
 * frame to catch up, so a short sample swings between 64 and 106 ticks per second
 * on an idle match and says nothing about either. Averaging over a window several
 * times longer than the catch-up bursts is the difference between a measurement
 * and a coin toss — and a flaky performance test is worse than none, because it
 * gets its threshold lowered until it cannot fail.
 */
const SAMPLE_MS = 3000;
/** Objects the scene may be left holding after everything has faded. */
const LEAK_TOLERANCE = 2;

interface BattleProbe {
  world: {
    phase: string;
    tick: number;
    hitStopTicks: number;
    ultimates: { elapsedTicks: number; fighterId: string }[];
    fighters: [
      { configId: string; energy: number; installTicks: number; state: string },
      { configId: string; energy: number; installTicks: number; state: string },
    ];
  };
}

/** Fill P1's meter from outside, so a test does not spend twenty seconds holding a key. */
async function grantMeter(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const battle = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as BattleProbe;
    battle.world.fighters[0].energy = 100;
  });
}

/**
 * Count the whole display list, containers included.
 *
 * `scene.children.length` is only the top level, and everything the battle draws
 * — fighters, projectiles, the ultimate's art — lives inside a world container.
 * Counting the top level says 24 whatever is happening underneath it, which is a
 * test that cannot fail rather than a test that passes.
 */
async function probe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const game = window.__MEME_CAT_GAME__!;
    const battle = game.scene.getScene('BattleScene') as unknown as BattleProbe;

    const count = (nodes: unknown[]): number =>
      nodes.reduce<number>((total, node) => {
        const children = (node as { list?: unknown[] }).list;
        return total + 1 + (Array.isArray(children) ? count(children) : 0);
      }, 0);

    return {
      tick: battle.world.tick,
      phase: battle.world.phase,
      ultimates: battle.world.ultimates.length,
      p1: battle.world.fighters[0].configId,
      p1State: battle.world.fighters[0].state,
      install: battle.world.fighters[0].installTicks,
      objects: count(game.scene.getScene('BattleScene').children.list),
      textures: game.textures.getTextureKeys().filter((k) => k.startsWith('skill-')).length,
    };
  });
}

test('an ultimate draws its own art, keeps up, and cleans up after itself', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await startVersusBattle(page);
  await waitForFightPhase(page);

  const before = await probe(page);

  /**
   * The payload budget, as a range rather than a number.
   *
   * A match now loads both fighters' whole skill sheets instead of four cells
   * each, which is the point — but the failure worth catching on the other side is
   * loading the *roster's*. The sheets run from fourteen cells to twenty-three, so
   * two fighters is somewhere between 28 and 46, and all twelve would be 226.
   */
  expect(before.textures, 'both fighters’ full skill sheets should be loaded').toBeGreaterThan(20);
  expect(
    before.textures,
    'a match should load two fighters’ sheets, not the whole roster',
  ).toBeLessThan(60);

  /**
   * A baseline from this same session, because the absolute number is a property
   * of the machine as much as of the game.
   *
   * Headless Chromium throttles its frame callbacks, so a fixed 60 here would
   * fail on the test runner while the real browser was fine — and a threshold
   * that fails for reasons unrelated to the change gets raised until it means
   * nothing. What the ultimate must not do is make the client *worse*, and that
   * is measurable against ordinary play a second earlier.
   */
  const baselineStart = before.tick;
  await page.waitForTimeout(SAMPLE_MS);
  const baselineTicks = (await probe(page)).tick - baselineStart;
  expect(baselineTicks, 'the match should be simulating at all').toBeGreaterThan(SAMPLE_MS / 20);

  /**
   * Ask more than once.
   *
   * A single press is a single tick of input, and it is dropped if it lands while
   * the fighter is busy or on the boundary of the round intro — a one-shot press
   * is a coin toss dressed up as a test.
   */
  await expect(async () => {
    await grantMeter(page);
    await page.keyboard.press('t');
    await page.waitForTimeout(800);
    const started = await page.evaluate(() => {
      const battle = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as BattleProbe;
      return battle.world.ultimates.length > 0 || battle.world.hitStopTicks > 0;
    });
    expect(started, 'the ultimate should have started').toBe(true);
  }).toPass({ timeout: 45_000 });

  /**
   * Wait until the timeline is a few ticks in, not merely until it exists.
   *
   * The cut-in is spent as a freeze before the timeline starts, and the scripts
   * open a few ticks after that — a wind-up, a portal, a warning ring. Sampling on
   * the tick the ultimate appears is sampling before anything has been drawn.
   *
   * Polled on an interval rather than on every animation frame, and kept to a
   * field read. The obvious version of this wait walks the display list looking
   * for growth, which runs a tree walk every frame *of the window it is about to
   * measure* — the measurement then reports the cost of taking it.
   */
  await page.waitForFunction(
    () => {
      const battle = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as BattleProbe;
      return (battle.world.ultimates[0]?.elapsedTicks ?? 0) >= 12;
    },
    undefined,
    { timeout: 30_000, polling: 250 },
  );

  // Mid-presentation: something is on screen, and it is not everything.
  const during = await probe(page);
  expect(during.objects, 'the ultimate should be drawing something').toBeGreaterThan(before.objects);
  expect(
    during.objects - before.objects,
    `an ultimate may hold at most ${MAX_ULTIMATE_OBJECTS} objects at once`,
  ).toBeLessThanOrEqual(MAX_ULTIMATE_OBJECTS);

  // The number that matters is ticks, not frames: a client can render badly and
  // still simulate perfectly, and only the first of those is the player's problem.
  const startTick = during.tick;
  await page.waitForTimeout(SAMPLE_MS);
  const after = await probe(page);
  const ultimateTicks = after.tick - startTick;

  /**
   * During the presentation, only a floor.
   *
   * Measured against a control run — the same match with and without an ultimate
   * — the presentation costs about 9% of the tick rate and gives it straight
   * back. But the sample swings widely on a loaded machine, so a tight ratio here
   * fails for reasons that have nothing to do with the game, and a threshold that
   * fails spuriously gets lowered until it cannot fail at all. What this catches
   * is the failure worth catching: a presentation that stalls the simulation
   * outright.
   */
  expect(
    ultimateTicks,
    `the simulation stalled during the ultimate (${ultimateTicks} ticks in ${SAMPLE_MS} ms)`,
  ).toBeGreaterThan((SAMPLE_MS / 1000) * MIN_TICKS_PER_SECOND);

  // And nothing left behind once it is over.
  await page.waitForFunction(
    () => {
      const battle = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as BattleProbe;
      return battle.world.ultimates.length === 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(3000);

  const settled = await probe(page);
  expect(
    settled.objects,
    'every object an ultimate created should have retired itself',
  ).toBeLessThanOrEqual(before.objects + LEAK_TOLERANCE);

  /**
   * And the rate comes back.
   *
   * This is the strict half, and it is the one that means something: a
   * presentation is allowed to cost while it is on screen, and is not allowed to
   * leave the client slower than it found it. That is the shape every leak takes
   * — an accumulating tween, a sprite nobody destroyed, a listener still bound —
   * and unlike the during-ultimate sample it is measured against quiet play on
   * both sides, so it is stable enough to hold to a ratio.
   */
  const recoveryStart = settled.tick;
  await page.waitForTimeout(SAMPLE_MS);
  const recovered = (await probe(page)).tick - recoveryStart;
  expect(
    recovered,
    `the client did not recover after the ultimate ` +
      `(before ${baselineTicks}, after ${recovered}, per ${SAMPLE_MS} ms)`,
  ).toBeGreaterThanOrEqual(Math.floor(baselineTicks * SLOWDOWN_ALLOWANCE));

  expect(errors).toEqual([]);
});

test('a transformation swaps the fighter and puts it back', async ({ page }) => {
  await page.goto('/');
  // Chosen, not left to the random pick: only four of the twelve transform, so a
  // test that took whoever turned up would skip itself two times in three.
  await startVersusBattleAs(page, 'doge');
  await waitForFightPhase(page);

  const chosen = await page.evaluate(() => {
    const battle = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as BattleProbe;
    battle.world.fighters[0].energy = 100;
    return battle.world.fighters[0].configId;
  });
  expect(chosen, 'the select-grid navigation should have landed on doge').toBe('doge');

  /**
   * Ask more than once.
   *
   * A single press is a single tick of input, and it is dropped if it lands while
   * the fighter is busy — mid-hitstun, mid-recovery, or on the boundary of the
   * round intro. That makes a one-shot press a coin toss dressed up as a test, so
   * this keeps asking until the ultimate is out, topping the meter back up each
   * time in case an earlier press did spend it.
   */
  await expect(async () => {
    await page.evaluate(() => {
      const battle = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as BattleProbe;
      battle.world.fighters[0].energy = 100;
    });
    await page.keyboard.press('t');
    await page.waitForTimeout(1500);
    const installed = await page.evaluate(() => {
      const battle = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as BattleProbe;
      return battle.world.fighters[0].installTicks;
    });
    expect(installed, 'doge should have transformed').toBeGreaterThan(0);
  }).toPass({ timeout: 60_000 });

  const transformed = await page.evaluate(() => {
    const game = window.__MEME_CAT_GAME__!;
    const battle = game.scene.getScene('BattleScene') as unknown as BattleProbe;

    // Recursive, because the fighters are inside the world container rather than
    // on the scene's top-level display list.
    const keys = (nodes: unknown[]): string[] =>
      nodes.flatMap((node) => {
        const children = (node as { list?: unknown[] }).list;
        const own = (node as { texture?: { key: string } }).texture?.key;
        return [
          ...(own ? [own] : []),
          ...(Array.isArray(children) ? keys(children) : []),
        ];
      });

    return {
      fighter: battle.world.fighters[0].configId,
      keys: keys(game.scene.getScene('BattleScene').children.list),
    };
  });

  // The transformed body comes off the skill sheet, not the numbered pose sheet —
  // and specifically off the transformed set, which is what was missing entirely
  // when an install was a colour tint.
  const installPoses = ['j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r'];
  expect(
    transformed.keys.some((key) => installPoses.some((cell) => key === `skill-doge-${cell}`)),
    `nothing on screen was drawn from doge's transformed sheet: ${transformed.keys.join(', ')}`,
  ).toBe(true);
});
