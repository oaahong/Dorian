import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIGHTERS } from '../fighterData';
import { SKILL_CELLS } from '../skillCells';
import { skillTexturesFor } from '../poseSheet';

/**
 * The skill sheets, as a table the client can read without a filesystem.
 *
 * `SKILL_CELLS` is generated from the pipeline's own manifest by
 * `scripts/gen-skill-cells.mjs`, because the manifest is 163 KB of crop
 * rectangles and SHA digests that no browser needs. These tests are the seam:
 * they read the manifest here, in Node, and fail if the generated table has
 * drifted from it — which is what happens when somebody reruns
 * `npm run assets:skills` and forgets the codegen step.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..');

interface ManifestAsset {
  poseId: string;
  outputPath: string;
}

interface Manifest {
  fighters: Record<string, { assets: ManifestAsset[]; derivedAssets?: ManifestAsset[] }>;
}

const manifest = (): Manifest =>
  JSON.parse(
    readFileSync(join(REPO_ROOT, 'audit', 'skill-assets', 'skill-asset-manifest.json'), 'utf8'),
  ) as Manifest;

describe('SKILL_CELLS', () => {
  it('lists exactly the cells the asset pipeline produced, for every fighter', () => {
    const fighters = manifest().fighters;
    for (const [fighterId, entry] of Object.entries(fighters)) {
      // `derivedAssets` is where blade's two split swords live; they are textures
      // the game loads exactly like any other cell, so the table carries both.
      const fromManifest = [...entry.assets, ...(entry.derivedAssets ?? [])]
        .map((asset) => asset.poseId)
        .sort();
      const fromTable = [...(SKILL_CELLS[fighterId] ?? [])].sort();
      expect(fromTable, fighterId).toEqual(fromManifest);
    }
  });

  it('covers the whole roster and nothing beyond it', () => {
    expect(Object.keys(SKILL_CELLS).sort()).toEqual(FIGHTERS.map((f) => f.id).sort());
  });

  it('includes the two derived weapon modules, which are files but not cells', () => {
    // The pipeline splits blade's K cell into a left and a right sword. They are
    // real textures the install has to mount, so the table has to carry them even
    // though no source cell is named `K_weapon_blue`.
    expect(SKILL_CELLS.blade).toContain('K_weapon_blue');
    expect(SKILL_CELLS.blade).toContain('K_weapon_black');
  });
});

describe('skillTexturesFor', () => {
  it('asks for every cell the fighter has, with no duplicates', () => {
    for (const fighter of FIGHTERS) {
      const textures = skillTexturesFor(fighter.id);
      expect(textures.length, fighter.id).toBe(SKILL_CELLS[fighter.id]!.length);
      expect(new Set(textures.map((t) => t.key)).size, fighter.id).toBe(textures.length);
    }
  });

  it('names a file that is actually on disk, for every cell of every fighter', () => {
    // The one check that catches a rename in `public/` — a missing texture is
    // otherwise a silent `loaderror` warning and an invisible attacker.
    for (const fighter of FIGHTERS) {
      for (const { key, path } of skillTexturesFor(fighter.id)) {
        expect(existsSync(join(REPO_ROOT, 'public', path)), `${key} -> ${path}`).toBe(true);
      }
    }
  });

  it('keys a texture by fighter and lower-cased cell', () => {
    expect(skillTexturesFor('alien')).toContainEqual({
      key: 'skill-alien-a',
      path: 'assets/skills/alien/A.webp',
    });
  });
});
