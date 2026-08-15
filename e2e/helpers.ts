import type { Page } from '@playwright/test';

/**
 * Boot decodes eight ~3.3 MB card PNGs and then runs 8 x 13 canvas extraction
 * passes synchronously on the main thread, so reaching the title screen takes
 * seconds even on a fast machine.
 */
export const BOOT_TIMEOUT_MS = 90_000;

/** Wait until `key` is one of the scenes Phaser currently has running. */
export async function waitForScene(page: Page, key: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    (wanted) => {
      const game = window.__MEME_CAT_GAME__;
      if (!game) return false;
      return game.scene.getScenes(true).some((scene) => scene.scene.key === wanted);
    },
    key,
    { timeout },
  );
}

/** The scene keys Phaser currently has running, for assertion messages. */
export async function activeSceneKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const game = window.__MEME_CAT_GAME__;
    if (!game) return [];
    return game.scene.getScenes(true).map((scene) => scene.scene.key);
  });
}

/**
 * Menu scenes arm a ~300 ms `inputLockedUntil` guard in `create()` so that the
 * keypress which entered the scene cannot immediately fall through to the next
 * one. Tests must respect it or keypresses are silently dropped.
 */
export async function pressAfterInputUnlock(page: Page, key: string): Promise<void> {
  await page.waitForTimeout(450);
  await page.keyboard.press(key);
}

/**
 * Drive the menus from a fresh page load to the start of a 1P-vs-CPU battle.
 * Mirrors the real key sequence a player would use, so it breaks if menu
 * navigation regresses.
 */
export async function startCpuBattle(page: Page): Promise<void> {
  await waitForScene(page, 'TitleScene', BOOT_TIMEOUT_MS);

  await page.keyboard.press('Space');             // TitleScene: press any key
  await waitForScene(page, 'ModeSelectScene');

  await pressAfterInputUnlock(page, 'f');          // default option is 1P VS CPU
  await waitForScene(page, 'CharacterSelectScene');

  await pressAfterInputUnlock(page, 'f');          // P1 confirms; CPU picks at random
  await waitForScene(page, 'BattleScene', 20_000); // VsScene holds for ~1.75 s
}

/** Same as {@link startCpuBattle} but selects `2P VS P2`, so both seats are human. */
export async function startVersusBattle(page: Page): Promise<void> {
  await waitForScene(page, 'TitleScene', BOOT_TIMEOUT_MS);

  await page.keyboard.press('Space');
  await waitForScene(page, 'ModeSelectScene');

  // 'w' moves up the list, which now wraps to ONLINE VS; 's' steps down to the
  // second entry.
  await pressAfterInputUnlock(page, 's');          // 1P VS CPU -> 2P VS P2
  await page.waitForTimeout(120);
  await page.keyboard.press('f');
  await waitForScene(page, 'CharacterSelectScene');

  await pressAfterInputUnlock(page, 'f');          // P1 locks in
  await page.waitForTimeout(150);
  await page.keyboard.press('j');                  // P2 locks in
  await waitForScene(page, 'BattleScene', 20_000);
}

/** A read-only view of the live battle, for assertions. */
export interface BattleProbe {
  phase: string;
  tick: number;
  p1: { x: number; hp: number; state: string };
  p2: { x: number; hp: number; state: string };
}

/**
 * Shape of the simulation state BattleScene owns. Declared here rather than
 * imported so the e2e specs stay decoupled from the simulation's own types —
 * these run against the built bundle, where nothing is importable anyway.
 */
interface BattleSceneProbe {
  world?: {
    phase: string;
    tick: number;
    fighters: [
      { x: number; hp: number; state: string },
      { x: number; hp: number; state: string },
    ];
  };
}

/**
 * The simulation ignores input during its ~1.12 s `intro` phase, so any test that
 * presses a gameplay key must wait for `fight` first or the press is swallowed.
 */
export async function waitForFightPhase(page: Page, who = 'player'): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const battle = window.__MEME_CAT_GAME__?.scene.getScene('BattleScene');
        return (battle as unknown as BattleSceneProbe | null)?.world?.phase === 'fight';
      },
      undefined,
      { timeout: 20_000 },
    );
  } catch (error) {
    // Online, the intro cannot advance without the opponent's inputs, so this
    // times out for reasons that live on the *other* machine. The session's own
    // status says which: still loading, waiting on a frame, or diverged.
    throw new Error(
      `${who} never reached the fight phase. Battle state: ${JSON.stringify(await readSession(page))}`,
      { cause: error },
    );
  }
}

/** What the battle and its network session are doing, for failure messages. */
export async function readSession(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const game = window.__MEME_CAT_GAME__;
    const battle = game?.scene.getScene('BattleScene') as unknown as
      | {
          online?: boolean;
          world?: { tick: number; phase: string };
          session?: { status?: string; stalledTicks?: number; inputDelay?: number; localPlayer?: number };
        }
      | null;
    return {
      scenes: game?.scene.getScenes(true).map((scene) => scene.scene.key) ?? [],
      online: battle?.online ?? null,
      tick: battle?.world?.tick ?? null,
      phase: battle?.world?.phase ?? null,
      status: battle?.session?.status ?? null,
      stalledTicks: battle?.session?.stalledTicks ?? null,
      inputDelay: battle?.session?.inputDelay ?? null,
      seat: battle?.session?.localPlayer ?? null,
    };
  });
}

/** Read fighter positions and states out of the running simulation. */
export async function readBattle(page: Page): Promise<BattleProbe> {
  return page.evaluate(() => {
    const battle = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as {
      world: {
        phase: string;
        tick: number;
        fighters: [
          { x: number; hp: number; state: string },
          { x: number; hp: number; state: string },
        ];
      };
    };
    const snapshot = (f: { x: number; hp: number; state: string }) => ({ x: f.x, hp: f.hp, state: f.state });
    return {
      phase: battle.world.phase,
      tick: battle.world.tick,
      p1: snapshot(battle.world.fighters[0]),
      p2: snapshot(battle.world.fighters[1]),
    };
  });
}
