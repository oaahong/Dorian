import { test, expect, type Page } from '@playwright/test';
import { BOOT_TIMEOUT_MS, readBattle, waitForFightPhase, waitForScene } from './helpers';

/**
 * Two browsers, one server, one match.
 *
 * The headless equivalent in server/__tests__ already proves the simulations stay
 * identical; what only a browser can show is that the whole product works — that
 * a player can reach the lobby, read a code out, have a friend type it, and see
 * their own keypresses move a fighter on someone else's screen.
 */

/** Walk a fresh page to the online lobby. */
async function openLobby(page: Page): Promise<void> {
  await page.goto('/');
  await waitForScene(page, 'TitleScene', BOOT_TIMEOUT_MS);
  await page.keyboard.press('Space');
  await waitForScene(page, 'ModeSelectScene');

  await page.waitForTimeout(450);
  await page.keyboard.press('s'); // 1P VS CPU -> 2P VS P2
  await page.waitForTimeout(120);
  await page.keyboard.press('s'); // -> ONLINE VS
  await page.waitForTimeout(120);
  await page.keyboard.press('f');

  await waitForScene(page, 'OnlineLobbyScene');
  // The scene only leaves 'connecting' once the socket is open.
  await page.waitForFunction(
    () => {
      const lobby = window.__MEME_CAT_GAME__?.scene.getScene('OnlineLobbyScene');
      return (lobby as unknown as { phase?: string } | null)?.phase === 'menu';
    },
    undefined,
    { timeout: 15_000 },
  );
}

async function roomCode(page: Page): Promise<string> {
  await page.waitForFunction(
    () => {
      const lobby = window.__MEME_CAT_GAME__?.scene.getScene('OnlineLobbyScene');
      return !!(lobby as unknown as { room?: { code: string } } | null)?.room?.code;
    },
    undefined,
    { timeout: 10_000 },
  );
  return page.evaluate(() => {
    const lobby = window.__MEME_CAT_GAME__!.scene.getScene('OnlineLobbyScene') as unknown as {
      room: { code: string };
    };
    return lobby.room.code;
  });
}

test('two players meet with a room code and fight', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await openLobby(host);
    await openLobby(guest);

    await host.keyboard.press('f'); // create a room
    const code = await roomCode(host);
    expect(code).toHaveLength(6);

    await guest.keyboard.press('j'); // join with a code
    await guest.waitForTimeout(150);
    for (const character of code) await guest.keyboard.press(character);
    await guest.keyboard.press('Enter');

    // Both sides now see a full room.
    await roomCode(guest);

    await host.keyboard.press('f'); // pick and ready
    await guest.waitForTimeout(120);
    await guest.keyboard.press('f');

    await waitForScene(host, 'BattleScene', 20_000);
    await waitForScene(guest, 'BattleScene', 20_000);
    await waitForFightPhase(host);
    await waitForFightPhase(guest);

    // The proof: a key pressed in one browser moves a fighter in the other.
    const before = await readBattle(guest);
    await host.keyboard.down('d');
    await host.waitForTimeout(900);
    await host.keyboard.up('d');
    await guest.waitForTimeout(300);

    const after = await readBattle(guest);
    expect(after.p1.x, 'the guest should see the host walking').toBeGreaterThan(before.p1.x);

    // And both simulations agree about where everyone is.
    const hostView = await readBattle(host);
    const guestView = await readBattle(guest);
    expect(Math.abs(hostView.tick - guestView.tick)).toBeLessThan(30);
    expect(hostView.p1.hp).toBe(guestView.p1.hp);
    expect(hostView.p2.hp).toBe(guestView.p2.hp);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('joining a room that does not exist reports an error', async ({ page }) => {
  await openLobby(page);

  await page.keyboard.press('j');
  await page.waitForTimeout(150);
  for (const character of 'ZZZZZZ') await page.keyboard.press(character);
  await page.keyboard.press('Enter');

  await page.waitForFunction(
    () => {
      const lobby = window.__MEME_CAT_GAME__?.scene.getScene('OnlineLobbyScene');
      return !!(lobby as unknown as { message?: string } | null)?.message;
    },
    undefined,
    { timeout: 10_000 },
  );
  const message = await page.evaluate(
    () => (window.__MEME_CAT_GAME__!.scene.getScene('OnlineLobbyScene') as unknown as { message: string }).message,
  );
  expect(message).toContain('ROOM');
});
