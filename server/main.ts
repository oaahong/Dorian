import { resolve } from 'node:path';
import { startServer } from './index';

/**
 * Production entry point.
 *
 * One process serves the built client and the WebSocket on the same origin, so
 * the page connects to `/ws` without knowing a hostname and there is no CORS or
 * certificate story beyond what the platform terminates.
 */
const port = Number(process.env.PORT ?? 8080);

startServer({ port, staticDir: resolve('dist') })
  .then((server) => {
    console.log(`meme-cat-fighter listening on :${server.port}`);

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        void server.close().then(() => process.exit(0));
      });
    }
  })
  .catch((error) => {
    console.error('Failed to start:', error);
    process.exit(1);
  });
