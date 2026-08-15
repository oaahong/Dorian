import { describe, it, expect } from 'vitest';
import { FIGHTERS, getFighterConfig } from '../fighterData';
import { HEAVY_ATTACK, LIGHT_ATTACK, type AttackSpec } from '../../combat/AttackSpec';

/**
 * The roster is the input data the simulation reads every frame. Once the sim is
 * headless and deterministic, a malformed entry here (a missing projectileSpeed,
 * a duplicated attack id) shows up as a desync between two clients rather than a
 * crash. Validating the shape up front keeps that class of bug out of netcode.
 */

const ALL_SPECS: AttackSpec[] = [
  LIGHT_ATTACK,
  HEAVY_ATTACK,
  ...FIGHTERS.flatMap((fighter) => [fighter.special, fighter.ultimate]),
];

describe('roster', () => {
  it('has exactly eight fighters', () => {
    expect(FIGHTERS).toHaveLength(8);
  });

  it('gives every fighter a unique id', () => {
    const ids = FIGHTERS.map((fighter) => fighter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers the fighters 01..08 in roster order', () => {
    expect(FIGHTERS.map((fighter) => fighter.number)).toEqual([
      '01', '02', '03', '04', '05', '06', '07', '08',
    ]);
  });

  it('derives every card texture key from the fighter number', () => {
    // BootScene loads `assets/cards/card-${number}.png` under this key, so a
    // mismatch means a fighter silently renders as the fallback card.
    for (const fighter of FIGHTERS) {
      expect(fighter.cardTexture).toBe(`card-${fighter.number}`);
    }
  });

  it('fills in every display string', () => {
    for (const fighter of FIGHTERS) {
      for (const field of ['name', 'shortName', 'archetype', 'tagline'] as const) {
        expect(fighter[field].length, `${fighter.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it('resolves known ids and rejects unknown ones', () => {
    expect(getFighterConfig('collapse').name).toBe('崩潰喵喵貓');
    expect(() => getFighterConfig('no-such-cat')).toThrow(/Unknown fighter id/);
  });
});

describe('fighter stats', () => {
  const STAT_FIELDS = ['hpStat', 'attackStat', 'speedStat', 'rangeStat', 'controlStat'] as const;

  it('keeps every stat an integer in 1..5', () => {
    for (const fighter of FIGHTERS) {
      for (const field of STAT_FIELDS) {
        const value = fighter[field];
        expect(Number.isInteger(value), `${fighter.id}.${field} = ${value}`).toBe(true);
        expect(value, `${fighter.id}.${field}`).toBeGreaterThanOrEqual(1);
        expect(value, `${fighter.id}.${field}`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('keeps total stat points within the roster’s existing 15..19 band', () => {
    // Characterizing the roster as it stands, not imposing a budget it never had:
    // salad is the lightest at 15, wizard the heaviest at 19. The guard exists so
    // that a newly added fighter has to be a deliberate outlier, not an accident.
    const totals = FIGHTERS.map((fighter) =>
      STAT_FIELDS.reduce((sum, field) => sum + fighter[field], 0),
    );
    expect(Math.min(...totals)).toBe(15);
    expect(Math.max(...totals)).toBe(19);
  });

  it('uses palette colours inside the 24-bit RGB range', () => {
    for (const fighter of FIGHTERS) {
      for (const [name, colour] of Object.entries(fighter.palette)) {
        expect(Number.isInteger(colour), `${fighter.id}.palette.${name}`).toBe(true);
        expect(colour, `${fighter.id}.palette.${name}`).toBeGreaterThanOrEqual(0);
        expect(colour, `${fighter.id}.palette.${name}`).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});

describe('attack specs', () => {
  it('gives every attack a unique id', () => {
    const ids = ALL_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defines a positive startup/active/recovery window for every attack', () => {
    for (const spec of ALL_SPECS) {
      expect(spec.startupMs, `${spec.id}.startupMs`).toBeGreaterThan(0);
      expect(spec.activeMs, `${spec.id}.activeMs`).toBeGreaterThan(0);
      expect(spec.recoveryMs, `${spec.id}.recoveryMs`).toBeGreaterThan(0);
    }
  });

  it('survives the conversion to 60 Hz ticks without collapsing a window to zero', () => {
    // Phase 2 rounds every *Ms field to whole ticks. A window shorter than half a
    // tick would round to 0 and make the attack unable to ever connect.
    const toTicks = (ms: number) => Math.round((ms * 60) / 1000);
    for (const spec of ALL_SPECS) {
      expect(toTicks(spec.startupMs), `${spec.id}.startupMs`).toBeGreaterThan(0);
      expect(toTicks(spec.activeMs), `${spec.id}.activeMs`).toBeGreaterThan(0);
      expect(toTicks(spec.recoveryMs), `${spec.id}.recoveryMs`).toBeGreaterThan(0);
    }
  });

  it('deals positive damage with reach and a hitstun advantage over blockstun', () => {
    for (const spec of ALL_SPECS) {
      expect(spec.damage, `${spec.id}.damage`).toBeGreaterThan(0);
      expect(spec.reach, `${spec.id}.reach`).toBeGreaterThan(0);
      // Blocking must always be better than being hit, or blocking is pointless.
      expect(spec.blockstunMs, `${spec.id}`).toBeLessThan(spec.hitstunMs);
    }
  });

  it('knocks the defender backwards and never downwards', () => {
    for (const spec of ALL_SPECS) {
      expect(spec.knockbackX, `${spec.id}.knockbackX`).toBeGreaterThan(0);
      expect(spec.knockbackY, `${spec.id}.knockbackY`).toBeLessThanOrEqual(0);
    }
  });

  it('keeps chip damage a fraction of the full hit', () => {
    for (const spec of ALL_SPECS) {
      const chip = spec.chipRatio ?? 0;
      expect(chip, `${spec.id}.chipRatio`).toBeGreaterThanOrEqual(0);
      expect(chip, `${spec.id}.chipRatio`).toBeLessThan(1);
    }
  });

  it('never lets a single normal attack take more than a fifth of a health bar', () => {
    expect(LIGHT_ATTACK.damage).toBeLessThan(HEAVY_ATTACK.damage);
    expect(HEAVY_ATTACK.damage).toBeLessThan(20);
  });
});

describe('special and ultimate wiring', () => {
  it('gives every special a cooldown and every ultimate none', () => {
    for (const fighter of FIGHTERS) {
      expect(fighter.special.cooldownMs, `${fighter.id}.special`).toBeGreaterThan(0);
      // Ultimates are gated by the 100-point meter, not by a timer.
      expect(fighter.ultimate.cooldownMs, `${fighter.id}.ultimate`).toBeUndefined();
    }
  });

  it('grants no meter for landing an ultimate', () => {
    for (const fighter of FIGHTERS) {
      expect(fighter.ultimate.energyOnHit, `${fighter.id}.ultimate`).toBe(0);
      expect(fighter.special.energyOnHit, `${fighter.id}.special`).toBeGreaterThan(0);
    }
  });

  it('makes every ultimate hit harder and reach further than its special', () => {
    for (const fighter of FIGHTERS) {
      expect(fighter.ultimate.damage, `${fighter.id}`).toBeGreaterThan(fighter.special.damage);
      expect(fighter.ultimate.hitstunMs, `${fighter.id}`).toBeGreaterThan(fighter.special.hitstunMs);
    }
  });

  it('tags every ultimate with an `ultimate-` kind and no special with one', () => {
    for (const fighter of FIGHTERS) {
      expect(fighter.ultimate.kind.startsWith('ultimate-'), `${fighter.id}.ultimate`).toBe(true);
      expect(fighter.special.kind.startsWith('ultimate-'), `${fighter.id}.special`).toBe(false);
    }
  });

  it('supplies the fields each attack kind needs at runtime', () => {
    // CombatSystem reads these per kind; a missing field falls back to a default
    // that silently changes the move rather than failing loudly.
    for (const spec of ALL_SPECS) {
      if (['sonic', 'water', 'salad'].includes(spec.kind)) {
        expect(spec.projectileSpeed, `${spec.id}.projectileSpeed`).toBeGreaterThan(0);
        expect(spec.lifetimeMs, `${spec.id}.lifetimeMs`).toBeGreaterThan(0);
      }
      if (['zone', 'ultimate-salad'].includes(spec.kind)) {
        expect(spec.telegraphMs, `${spec.id}.telegraphMs`).toBeGreaterThan(0);
      }
      if (spec.kind === 'aura') {
        expect(spec.stunLockoutMs, `${spec.id}.stunLockoutMs`).toBeGreaterThan(0);
      }
    }
  });

  it('covers all eight ultimate kinds exactly once', () => {
    const kinds = FIGHTERS.map((fighter) => fighter.ultimate.kind).sort();
    expect(kinds).toEqual([
      'ultimate-alien', 'ultimate-freeze', 'ultimate-magic', 'ultimate-ok',
      'ultimate-salad', 'ultimate-social', 'ultimate-sonic', 'ultimate-water',
    ]);
  });
});
