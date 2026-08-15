import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the determinism rules that everything else depends on.
 *
 * These would be ESLint rules in a project that already had ESLint; this repo has
 * none, and pulling in the whole toolchain for two rules is not worth it. A test
 * catches the same mistakes at the same point in the workflow, with the advantage
 * that the reason is written down next to the assertion.
 *
 * The rules exist because a violation is invisible locally: the game plays fine
 * on one machine and desyncs only once two clients are involved.
 */

const SIM_DIR = join(__dirname, '..');

function simSources(): { name: string; source: string }[] {
  return readdirSync(SIM_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, source: readFileSync(join(SIM_DIR, name), 'utf8') }));
}

/** Strip comments so a rule named in prose does not trip its own guard. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('src/sim purity', () => {
  const files = simSources();

  it('finds the simulation sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('$name does not import Phaser', ({ source }) => {
    // The simulation has to run headless in Node, both for tests and so a server
    // could one day run it for authority.
    expect(code(source)).not.toMatch(/from\s+['"]phaser['"]/);
  });

  it.each(files)('$name does not import from the render or scene layers', ({ source }) => {
    expect(code(source)).not.toMatch(/from\s+['"][^'"]*\/(render|scenes|ui|stages)\//);
  });

  it.each(files)('$name does not read wall-clock time', ({ name, source }) => {
    // Gameplay time is a tick counter. A wall clock drifts between two machines,
    // and cannot be rewound for a rollback.
    expect(code(source), name).not.toMatch(/\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bperformance\s*\.\s*now\b/);
  });

  it.each(files)('$name does not use Math.random', ({ name, source }) => {
    // Randomness comes from the seeded generator in rng.ts, whose state lives in
    // SimWorld and therefore snapshots and replays with everything else.
    expect(code(source), name).not.toMatch(/\bMath\s*\.\s*random\b/);
  });

  it.each(files)('$name does not call a transcendental function', ({ name, source }) => {
    /**
     * `Math.pow`, `sin`, `cos`, `exp` and friends are not required to be
     * bit-identical across JavaScript engines, and one differing bit in a
     * velocity is a desync. Only the exactly-rounded operations are allowed:
     * `+ - * /` and `Math.min/max/abs/floor/ceil/round/trunc/sign/sqrt`.
     *
     * The one place a transcendental result is needed — the per-tick stun
     * friction — is precomputed into a literal in constants.ts.
     */
    expect(code(source), name).not.toMatch(
      /\bMath\s*\.\s*(pow|sin|cos|tan|asin|acos|atan|atan2|exp|log|log2|log10|cbrt|hypot|sinh|cosh|tanh)\b/,
    );
  });

  it.each(files)('$name does not use the ** operator', ({ name, source }) => {
    // Exponentiation is the same hazard as Math.pow wearing different clothes.
    expect(code(source), name).not.toMatch(/\*\*/);
  });

  it('keeps the stun friction constant as a literal, not a computed value', () => {
    const constants = files.find((f) => f.name === 'constants.ts');
    expect(constants).toBeDefined();
    expect(constants!.source).toMatch(/STUN_FRICTION_PER_TICK\s*=\s*0\.\d+;/);
  });
});
