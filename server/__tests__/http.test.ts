import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { ROOM_TTL_MS } from '../rooms';
import { startServer, type RunningServer } from '../index';

/**
 * The parts of the server that are not the game: serving the built client, and
 * sweeping away what nobody is using.
 *
 * The client is served from the same origin as the socket so the page can connect
 * to `/ws` without knowing a hostname and without any CORS setup — which makes
 * this file part of the deployment story rather than an afterthought.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let server: RunningServer | null = null;
let staticDir: string | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  if (staticDir) rmSync(staticDir, { recursive: true, force: true });
  staticDir = null;
});

function makeStaticDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meme-cat-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Meme Cat</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("hi")');
  writeFileSync(join(dir, 'assets', 'app.css'), 'body{}');
  return dir;
}

async function get(path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${server!.port}${path}`);
}

describe('serving the client', () => {
  it('serves index.html at the root', async () => {
    staticDir = makeStaticDir();
    server = await startServer({ staticDir });

    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Meme Cat');
  });

  it('serves built assets with a usable content type', async () => {
    staticDir = makeStaticDir();
    server = await startServer({ staticDir });

    const script = await get('/assets/app.js');
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('javascript');

    const style = await get('/assets/app.css');
    expect(style.headers.get('content-type')).toContain('text/css');
  });

  it('falls back to index.html for an unknown path', async () => {
    // The game is a single page; a deep link must not 404.
    staticDir = makeStaticDir();
    server = await startServer({ staticDir });

    const response = await get('/lobby/ABC234');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Meme Cat');
  });

  it('refuses to walk out of the static directory', async () => {
    // Anything reachable above dist/ is server source or credentials.
    staticDir = makeStaticDir();
    server = await startServer({ staticDir });

    for (const path of ['/../package.json', '/assets/../../package.json', '/%2e%2e/package.json']) {
      const response = await get(path);
      expect([403, 200], path).toContain(response.status);
      if (response.status === 200) {
        // A fallback to index.html is fine; leaking a file is not.
        expect(await response.text(), path).not.toContain('"dependencies"');
      }
    }
  });

  it('answers the health check even with no static directory', async () => {
    server = await startServer({ staticDir: null });
    expect((await get('/healthz')).status).toBe(200);
  });

  it('404s other paths when serving no client', async () => {
    server = await startServer({ staticDir: null });
    expect((await get('/')).status).toBe(404);
  });
});

describe('sweeping', () => {
  it('closes the sockets of a room that has expired', async () => {
    // The clock is injected so a half-hour TTL can be tested in milliseconds.
    let clock = 1_000_000;
    server = await startServer({
      staticDir: null,
      seed: 3,
      now: () => clock,
      reapIntervalMs: 10,
    });

    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await new Promise<void>((resolve) => socket.once('open', () => resolve()));
    socket.send(JSON.stringify({ t: 'createRoom' }));
    await delay(50);
    expect(server.registry.rooms.size).toBe(1);

    clock += ROOM_TTL_MS + 1;
    await delay(100);

    expect(server.registry.rooms.size).toBe(0);
    socket.close();
  });

  it('leaves a fresh room alone', async () => {
    let clock = 1_000_000;
    server = await startServer({ staticDir: null, seed: 5, now: () => clock, reapIntervalMs: 10 });

    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await new Promise<void>((resolve) => socket.once('open', () => resolve()));
    socket.send(JSON.stringify({ t: 'createRoom' }));
    await delay(50);

    clock += 60_000;
    await delay(60);

    expect(server.registry.rooms.size).toBe(1);
    socket.close();
  });

  it('drops a connection that never joins a room', async () => {
    let clock = 1_000_000;
    server = await startServer({ staticDir: null, seed: 7, now: () => clock, reapIntervalMs: 10 });

    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await new Promise<void>((resolve) => socket.once('open', () => resolve()));

    clock += 10 * 60_000;
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
