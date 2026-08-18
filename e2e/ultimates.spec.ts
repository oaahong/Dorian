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
 * The floor the simulation may not drop through while an ultimate is on screen.
 *
 * A stall detector and nothing more. Deliberately far below 60, and deliberately
 * not a ratio against a baseline: measured over five consecutive ultimates on an
 * idle machine, the tick rate of this browser swings between 38 and 68 per second
 * from one window to the next. Anything tighter than this is measuring the runner.
 *
 * That is not a reason to give up on the property the ratio was there for. It is
 * a reason to measure it directly — see the resource assertions below, which
 * check for the leak itself instead of for its shadow in the frame rate.
 */
const MIN_TICKS_PER_SECOND = 10;

/** How many ultimates the leak check fires before comparing resources. */
const LEAK_ROUNDS = 3;

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
      // Tweens outlive their sprite if nobody kills them, and a tween on a dead
      // target costs frames without ever showing up in an object count.
      tweens: game.scene.getScene('BattleScene').tweens.getTweens().length,
      textures: game.textures.getTextureKeys().filter((k) => k.startsWith('skill-')).length,
    };
  });
}

/** Fire one ultimate and wait for its timeline to finish. */
async function fireUltimate(page: import('@playwright/test').Page): Promise<void> {
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

  await page.waitForFunction(
    () => {
      const battle = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as BattleProbe;
      return battle.world.ultimates.length === 0;
    },
    undefined,
    { timeout: 30_000, polling: 250 },
  );
}

/**
 * Wait until the scene is back to `baseline` objects and tweens.
 *
 * Polled rather than sampled after a fixed sleep, and the distinction is the
 * whole point. A beat fades out over its own lifetime, so "how many tweens are
 * live three seconds later" depends on which beat happened to be last and how
 * busy the machine was — sampling it is the same mistake as sampling the tick
 * rate, in a new costume. What is being asserted is that everything an ultimate
 * created *eventually* goes away, so the test waits for that and fails by timing
 * out if it never does.
 */
async function waitForQuiescence(
  page: import('@playwright/test').Page,
  baseline: { objects: number; tweens: number },
): Promise<void> {
  await expect(async () => {
    const now = await probe(page);
    expect(now.objects, 'display objects').toBeLessThanOrEqual(baseline.objects + LEAK_TOLERANCE);
    expect(now.tweens, 'live tweens').toBeLessThanOrEqual(baseline.tweens + LEAK_TOLERANCE);
  }).toPass({ timeout: 20_000, intervals: [500, 1000, 2000] });
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

  // A live match to begin with, so a later stalled reading means the ultimate.
  await page.waitForTimeout(500);
  expect((await probe(page)).tick, 'the match should be simulating at all')
    .toBeGreaterThan(before.tick);

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
   * During the presentation, a stall detector.
   *
   * This used to be a ratio against a baseline taken seconds earlier, on the
   * reasoning that an ultimate should not cost the client its footing. The
   * reasoning holds; the measurement does not. Sampled over five consecutive
   * ultimates on an idle machine this browser ranges from 38 to 68 ticks per
   * second between one window and the next, so a 15% band is inside the noise and
   * fails on whichever machine happens to be busy — which is how a threshold ends
   * up being lowered until it cannot fail at all.
   *
   * What that ratio was really trying to catch is a leak, and a leak is better
   * caught by looking for it. See below.
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
  await waitForQuiescence(page, before);

  expect(errors).toEqual([]);
});

test('firing ultimates over and over leaves nothing behind', async ({ page }) => {
  /**
   * The leak check, measured directly instead of through the frame rate.
   *
   * A leak is an accumulation: a sprite nobody destroyed, a tween still running
   * on a dead target, a texture created per use. Each of those is countable, and
   * counting them is both stabler and stricter than watching for their eventual
   * effect on how fast the client runs — a tween leak shows up here on the second
   * ultimate, and in a tick-rate sample only once there are enough of them to
   * outweigh the noise.
   *
   * Repeated rather than fired once, because one of anything leaks invisibly. The
   * numbers have to come back to where they started every time.
   */
  await page.goto('/');
  await startVersusBattleAs(page, 'alien');
  await waitForFightPhase(page);

  const before = await probe(page);

  for (let round = 1; round <= LEAK_ROUNDS; round += 1) {
    await fireUltimate(page);

    // Fails by timing out if the count never comes back down, which is what a
    // leak looks like: the excess is still there however long you wait.
    await waitForQuiescence(page, before);

    // Nothing an ultimate draws is generated at runtime; every cell was loaded
    // before the match started, so this one is true the instant the beat runs.
    const after = await probe(page);
    expect(
      after.textures,
      `textures were created during ultimate ${round}`,
    ).toBeLessThanOrEqual(before.textures);
  }
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
