import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIGHTERS } from '../fighterData';
import { POSE_NAMES, posePath, ultimateBackgroundPath } from '../poseSheet';

/**
 * Every asset path a match builds, checked against the filesystem.
 *
 * `skillCells.test.ts` has done this for the 226 skill cells for a while; the
 * poses and the twelve cut-in backgrounds had nothing equivalent, which left a
 * gap wide enough to drive a whole roster through. Nothing else catches a bad
 * path: a 404 is a `loaderror`, and the draw-time `textures.exists` guards in
 * `FighterView` and `UltimateStage` then render nothing rather than throwing —
 * so a mistyped directory shows up as a fighter that is simply invisible.
 *
 * These run in Node against `public/`, so they cost nothing and fail on the
 * commit that breaks them rather than in a browser three steps later.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..');

const onDisk = (path: string): boolean => existsSync(join(REPO_ROOT, 'public', path));

describe('posePath', () => {
  it('names a file that is actually on disk, for every pose of every fighter', () => {
    for (const fighter of FIGHTERS) {
      for (const pose of POSE_NAMES) {
        const path = posePath(fighter.id, pose);
        expect(onDisk(path), `${fighter.id}/${pose} -> ${path}`).toBe(true);
      }
    }
  });

  it('maps every pose to a distinct image, so no two poses share a frame', () => {
    // A duplicated number in a layout table is invisible in play — the fighter
    // just uses the wrong art for one move — and it is exactly the mistake a
    // hand-maintained pose-to-number map invites.
    for (const fighter of FIGHTERS) {
      const paths = POSE_NAMES.map((pose) => posePath(fighter.id, pose));
      expect(new Set(paths).size, fighter.id).toBe(POSE_NAMES.length);
    }
  });
});

describe('ultimateBackgroundPath', () => {
  it('names a file that is actually on disk, for every fighter', () => {
    for (const fighter of FIGHTERS) {
      const path = ultimateBackgroundPath(fighter.id);
      expect(onDisk(path), `${fighter.id} -> ${path}`).toBe(true);
    }
  });
});
