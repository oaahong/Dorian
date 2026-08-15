import type * as Phaser from 'phaser';

declare global {
  interface Window {
    /**
     * Test hook set in `main.ts`. The whole game renders into one canvas, so
     * without a handle on the Phaser instance an end-to-end test can only assert
     * that a canvas exists — which stays green even when the game is stuck on
     * the loading screen. Exposed in production builds too, because the smoke
     * tests run against the deployed bundle.
     */
    __MEME_CAT_GAME__?: Phaser.Game;
  }

  interface ImportMetaEnv {
    /**
     * Absolute WebSocket URL for the signalling server, e.g.
     * `wss://meme-cat-fighter.fly.dev/ws`. Leave unset when one process serves
     * both the client and the socket.
     */
    readonly VITE_WS_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
