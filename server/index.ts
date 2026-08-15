import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_JSON_BYTES,
  decodeBinary,
  decodeClientMessage,
  encodeJson,
  type ErrorCode,
  type RoomSlot,
  type ServerMessage,
} from '../src/net/protocol';
import {
  createRegistry,
  createRoom,
  isReadyToStart,
  joinRoom,
  leaveRoom,
  reapExpired,
  roomOf,
  selectCharacter,
  setReady,
  startMatch,
  type Registry,
  type Room,
  type Seat,
} from './rooms';

/**
 * Relay and room registry.
 *
 * The server does not simulate. Lockstep needs both clients to agree on the
 * inputs, not on an authority, so the only things this process decides are the
 * ones the two clients cannot decide independently: who is in which room, and the
 * seed and stage they must share.
 *
 * The honest limitation of that design is that a modified client can cheat.
 * For room-code matches between friends that is an acceptable trade; making it
 * cheat-proof means running the simulation here too, which the headless core
 * already allows but which nothing in this scope calls for.
 */

const DEFAULT_INPUT_DELAY = 3;
/**
 * Ceiling on messages per second per connection.
 *
 * A client in a match sends roughly 60 input messages a second plus the odd
 * checksum, so this is about five times what play needs — enough headroom for a
 * client catching up after a backgrounded tab, which can burst a dozen ticks in
 * one frame.
 */
const DEFAULT_RATE_LIMIT_PER_SECOND = 300;
const RATE_WINDOW_MS = 1000;
const REAP_INTERVAL_MS = 60_000;
/** A connection that never joins a room should not linger. */
const IDLE_TIMEOUT_MS = 5 * 60_000;

interface Connection {
  id: string;
  socket: WebSocket;
  messagesInWindow: number;
  windowStartedAt: number;
  connectedAt: number;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Directory of built client assets to serve, or null for an API-only server. */
  staticDir?: string | null;
  seed?: number;
  inputDelay?: number;
  /** Injected so tests can control expiry without waiting. */
  now?: () => number;
  /**
   * Messages per second per connection before the socket is closed. Configurable
   * because a test that plays a match faster than real time legitimately exceeds
   * what a 60 Hz client would ever send.
   */
  rateLimitPerSecond?: number;
  /** How often expired rooms and idle connections are swept. */
  reapIntervalMs?: number;
}

export interface RunningServer {
  port: number;
  registry: Registry;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const now = options.now ?? (() => Date.now());
  const inputDelay = options.inputDelay ?? DEFAULT_INPUT_DELAY;
  const rateLimit = options.rateLimitPerSecond ?? DEFAULT_RATE_LIMIT_PER_SECOND;
  const registry = createRegistry(options.seed ?? (now() & 0x7fffffff));
  const connections = new Map<string, Connection>();
  let nextConnectionId = 1;

  const staticDir = options.staticDir === undefined ? resolve('dist') : options.staticDir;
  const httpServer = createHttpServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
      return;
    }
    if (staticDir) serveStatic(staticDir, request, response);
    else {
      response.writeHead(404);
      response.end();
    }
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: MAX_JSON_BYTES });

  wss.on('connection', (socket) => {
    const connection: Connection = {
      id: `c${nextConnectionId++}`,
      socket,
      messagesInWindow: 0,
      windowStartedAt: now(),
      connectedAt: now(),
    };
    connections.set(connection.id, connection);

    socket.on('message', (data, isBinary) => {
      if (!withinRateLimit(connection, now(), rateLimit)) {
        sendError(socket, 'rate-limited', 'Too many messages');
        socket.close();
        return;
      }
      if (isBinary) handleBinary(connection, data as Buffer);
      else handleText(connection, data.toString());
    });

    socket.on('close', () => {
      handleDeparture(connection.id);
      connections.delete(connection.id);
    });

    // A socket error is a disconnect by another name; treat it the same rather
    // than letting it become an unhandled exception that stops the process.
    socket.on('error', () => socket.close());
  });

  const reaper = setInterval(() => {
    const currentTime = now();
    for (const reaped of reapExpired(registry, currentTime)) {
      for (const connId of reaped.connIds) {
        connections.get(connId)?.socket.close();
      }
    }
    for (const connection of connections.values()) {
      if (roomOf(registry, connection.id)) continue;
      if (currentTime - connection.connectedAt > IDLE_TIMEOUT_MS) connection.socket.close();
    }
  }, options.reapIntervalMs ?? REAP_INTERVAL_MS);
  reaper.unref?.();

  function handleText(connection: Connection, raw: string): void {
    const message = decodeClientMessage(raw);
    if (!message) {
      sendError(connection.socket, 'bad-message', 'Unrecognised message');
      return;
    }

    switch (message.t) {
      case 'createRoom': {
        const result = createRoom(registry, connection.id, now());
        if (!result.ok) return sendError(connection.socket, result.error, 'Cannot create a room');
        broadcastRoomState(result.room);
        return;
      }
      case 'joinRoom': {
        const result = joinRoom(registry, connection.id, message.code, now());
        if (!result.ok) return sendError(connection.socket, result.error, 'Cannot join that room');
        broadcastRoomState(result.room);
        return;
      }
      case 'selectCharacter': {
        const result = selectCharacter(registry, connection.id, message.characterId);
        if (!result.ok) return sendError(connection.socket, result.error, 'Not in a room');
        broadcastRoomState(result.room);
        return;
      }
      case 'ready': {
        const result = setReady(registry, connection.id, message.ready);
        if (!result.ok) return sendError(connection.socket, result.error, 'Not in a room');
        broadcastRoomState(result.room);
        if (isReadyToStart(result.room)) beginMatch(result.room);
        return;
      }
      case 'ping':
        send(connection.socket, { t: 'pong', id: message.id });
        return;
      case 'leave':
        handleDeparture(connection.id);
        return;
    }
  }

  /**
   * Gameplay traffic is validated and forwarded verbatim.
   *
   * Decoding proves it is a well-formed input or checksum packet rather than an
   * arbitrary payload aimed at the other client; re-encoding it would cost
   * something and prove nothing more.
   */
  function handleBinary(connection: Connection, data: Buffer): void {
    if (!decodeBinary(data)) return;

    const room = roomOf(registry, connection.id);
    if (!room) return;

    for (const player of room.players) {
      if (!player || player.connId === connection.id) continue;
      connections.get(player.connId)?.socket.send(data, { binary: true });
    }
  }

  function handleDeparture(connId: string): void {
    const departure = leaveRoom(registry, connId);
    if (!departure) return;
    for (const remainingId of departure.remaining) {
      const socket = connections.get(remainingId)?.socket;
      if (socket) send(socket, { t: 'opponentLeft' });
    }
  }

  function beginMatch(room: Room): void {
    const start = startMatch(registry, room);
    for (const player of room.players) {
      if (!player) continue;
      const socket = connections.get(player.connId)?.socket;
      if (socket) send(socket, { t: 'matchStart', ...start, inputDelay });
    }
  }

  function broadcastRoomState(room: Room): void {
    room.players.forEach((player, index) => {
      if (!player) return;
      const socket = connections.get(player.connId)?.socket;
      if (!socket) return;
      send(socket, {
        t: 'roomState',
        code: room.code,
        seat: index as Seat,
        slots: room.players.map(toSlot) as [RoomSlot | null, RoomSlot | null],
      });
    });
  }

  await new Promise<void>((resolveListen) => {
    httpServer.listen(options.port ?? 0, options.host ?? '0.0.0.0', resolveListen);
  });

  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    registry,
    close: () =>
      new Promise<void>((resolveClose) => {
        clearInterval(reaper);
        for (const connection of connections.values()) connection.socket.terminate();
        wss.close(() => httpServer.close(() => resolveClose()));
      }),
  };
}

function toSlot(player: { characterId: string | null; ready: boolean } | null): RoomSlot | null {
  return player ? { characterId: player.characterId, ready: player.ready } : null;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(encodeJson(message));
}

function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
  send(socket, { t: 'error', code, message });
}

function withinRateLimit(connection: Connection, nowMs: number, limit: number): boolean {
  if (nowMs - connection.windowStartedAt >= RATE_WINDOW_MS) {
    connection.windowStartedAt = nowMs;
    connection.messagesInWindow = 0;
  }
  connection.messagesInWindow += 1;
  return connection.messagesInWindow <= limit;
}

/**
 * Vite fingerprints everything under /assets with a content hash, so those files
 * can be cached forever. The card art and thumbnails keep stable names, so they
 * get a day — long enough that a returning player re-downloads nothing, short
 * enough that replacing the art is not a support problem. index.html is never
 * cached, or a deploy would not reach anyone.
 */
function cacheControlFor(requestPath: string, resolvedFile: string): string {
  if (resolvedFile.endsWith('index.html')) return 'no-cache';
  if (requestPath.startsWith('/assets/') && /-[A-Za-z0-9_]{8,}\./.test(requestPath)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=86400';
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/**
 * Serve the built client from the same origin as the socket, which avoids CORS
 * entirely and means the page can connect to `/ws` without knowing a hostname.
 */
function serveStatic(rootDir: string, request: IncomingMessage, response: ServerResponse): void {
  const requested = normalize(decodeURIComponent((request.url ?? '/').split('?')[0]!));
  // Reject traversal before touching the filesystem.
  const filePath = join(rootDir, requested);
  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    response.end();
    return;
  }

  const target =
    existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(rootDir, 'index.html');
  if (!existsSync(target)) {
    response.writeHead(404);
    response.end();
    return;
  }

  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
    'cache-control': cacheControlFor(requested, target),
  });
  createReadStream(target).pipe(response);
}
