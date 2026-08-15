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

  /**
   * Two conditions, not one. The scene leaves 'connecting' as soon as the socket
   * opens, which can easily be inside the 300 ms `inputLockedUntil` guard that
   * every menu scene arms — so returning on the phase alone left the next
   * keypress to be silently swallowed, and which test noticed depended on how
   * fast the other browser happened to be.
   */
  await page.waitForFunction(
    () => {
      const lobby = window.__MEME_CAT_GAME__?.scene.getScene('OnlineLobbyScene') as unknown as
        | { phase?: string; inputLockedUntil?: number; time?: { now: number } }
        | null;
      if (!lobby || lobby.phase !== 'menu') return false;
      return (lobby.time?.now ?? 0) >= (lobby.inputLockedUntil ?? Number.POSITIVE_INFINITY);
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** Everything about the lobby worth seeing when something goes wrong. */
async function lobbyState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const lobby = window.__MEME_CAT_GAME__?.scene.getScene('OnlineLobbyScene') as unknown as
      | { phase?: string; typedCode?: string; message?: string; room?: { code: string } | null; transportKind?: string | null }
      | null;
    return {
      scenes: window.__MEME_CAT_GAME__?.scene.getScenes(true).map((s) => s.scene.key) ?? [],
      phase: lobby?.phase ?? null,
      typedCode: lobby?.typedCode ?? null,
      message: lobby?.message ?? null,
      room: lobby?.room?.code ?? null,
      transportKind: lobby?.transportKind ?? null,
    };
  });
}

/**
 * Type a room code one character at a time, confirming each one landed.
 *
 * Blind-typing six keys and submitting was unstable: under the load of a full
 * suite run — two browser contexts, a peer connection being negotiated, several
 * megabytes downloading — one synthetic keypress occasionally failed to register,
 * and the test then submitted a five-character code and blamed the server.
 *
 * Measured separately, typing on an idle page lost nothing in 45 attempts at
 * intervals from 0 to 50 ms, so this is an artifact of driving input faster than
 * a person can while the page is starved, not something a player would hit. The
 * retype keeps the suite honest about what it is actually testing.
 */
async function typeRoomCode(page: Page, code: string): Promise<void> {
  for (let i = 0; i < code.length; i += 1) {
    await page.keyboard.press(code[i]!);
    try {
      await page.waitForFunction(
        (expected) => {
          const lobby = window.__MEME_CAT_GAME__?.scene.getScene('OnlineLobbyScene');
          return (lobby as unknown as { typedCode?: string } | null)?.typedCode === expected;
        },
        code.slice(0, i + 1),
        { timeout: 1500 },
      );
    } catch {
      await page.keyboard.press(code[i]!);
    }
  }

  await page.waitForFunction(
    (expected) => {
      const lobby = window.__MEME_CAT_GAME__?.scene.getScene('OnlineLobbyScene');
      return (lobby as unknown as { typedCode?: string } | null)?.typedCode === expected;
    },
    code,
    { timeout: 5000 },
  );
}

async function roomCode(page: Page, who = 'player'): Promise<string> {
  try {
    await page.waitForFunction(
      () => {
        const lobby = window.__MEME_CAT_GAME__?.scene.getScene('OnlineLobbyScene');
        return !!(lobby as unknown as { room?: { code: string } } | null)?.room?.code;
      },
      undefined,
      { timeout: 10_000 },
    );
  } catch (error) {
    // A bare timeout says nothing about why. The lobby's own state distinguishes
    // "the keypress was dropped" from "the server refused" from "the socket died".
    throw new Error(
      `${who} never received a room. Lobby state: ${JSON.stringify(await lobbyState(page))}`,
      { cause: error },
    );
  }
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
    const code = await roomCode(host, 'host');
    expect(code).toHaveLength(6);

    await guest.keyboard.press('j'); // join with a code
    await guest.waitForTimeout(150);
    await typeRoomCode(guest, code);
    await guest.keyboard.press('Enter');

    // Both sides now see a full room.
    await roomCode(guest, 'guest');

    await host.keyboard.press('f'); // pick and ready
    await guest.waitForTimeout(120);
    await guest.keyboard.press('f');

    await waitForScene(host, 'BattleScene', 20_000);
    await waitForScene(guest, 'BattleScene', 20_000);
    await waitForFightPhase(host, 'host');
    await waitForFightPhase(guest, 'guest');

    // Which connection carried the match. Two browsers on one machine can always
    // reach each other, so this should be direct; if it ever is not, the relay
    // fallback kept the match playable and that is worth knowing rather than
    // silently accepting.
    const link = await host.evaluate(() => {
      const scene = window.__MEME_CAT_GAME__!.scene.getScene('BattleScene') as unknown as {
        online: boolean;
      };
      return {
        online: scene.online,
        kind: (window as unknown as { __ONLINE_KIND__?: string }).__ONLINE_KIND__,
      };
    });
    expect(link.online).toBe(true);

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

test('a direct peer connection is preferred over the relay', async ({ browser }) => {
  /**
   * Relaying every keypress through a datacentre roughly triples the round trip
   * for two players in the same country, and the input delay is sized from it —
   * so a direct link is worth about half the delay a player feels. This asserts
   * the negotiation actually reaches one, rather than quietly always falling back.
   */
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await openLobby(host);
    await openLobby(guest);

    await host.keyboard.press('f');
    const code = await roomCode(host, 'host');
    await guest.keyboard.press('j');
    await guest.waitForTimeout(150);
    await typeRoomCode(guest, code);
    await guest.keyboard.press('Enter');
    await roomCode(guest, 'guest');

    const verdict = (page: Page) =>
      page.waitForFunction(
        () => {
          const lobby = window.__MEME_CAT_GAME__?.scene.getScene('OnlineLobbyScene');
          return (lobby as unknown as { transportKind?: string } | null)?.transportKind ?? null;
        },
        undefined,
        { timeout: 20_000 },
      ).then((handle) => handle.jsonValue());

    expect(await verdict(host)).toBe('p2p');
    expect(await verdict(guest)).toBe('p2p');
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('joining a room that does not exist reports an error', async ({ page }) => {
  await openLobby(page);

  await page.keyboard.press('j');
  await page.waitForTimeout(150);
  await typeRoomCode(page, 'ZZZZZZ');
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
