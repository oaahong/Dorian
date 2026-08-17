import { describe, it, expect } from 'vitest';
import { FIGHTERS, getFighterConfig } from '../fighterData';
import { allSpecials } from '../FighterConfig';
import { POSE_NAMES, poseNumber } from '../poseSheet';
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
  ...FIGHTERS.flatMap((fighter) => [...allSpecials(fighter), fighter.ultimate]),
];

/** The specials that are meant to touch someone — the utility moves are not. */
const CONTACT_SPECS = ALL_SPECS.filter((spec) => spec.damage > 0);

describe('roster', () => {
  it('has exactly twelve fighters', () => {
    expect(FIGHTERS).toHaveLength(12);
  });

  it('gives every fighter a unique id', () => {
    const ids = FIGHTERS.map((fighter) => fighter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers the fighters 01..12 in roster order', () => {
    expect(FIGHTERS.map((fighter) => fighter.number)).toEqual([
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
    ]);
  });

  it('starts every card texture with the fighter number', () => {
    // The card files carry a slug after the number — `card-08-blade-shield` —
    // so this cannot be derived, only checked for agreement. A mismatch means a
    // fighter silently renders as whatever texture did load.
    for (const fighter of FIGHTERS) {
      expect(fighter.cardTexture, fighter.id).toMatch(
        new RegExp(`^card-${fighter.number}-[a-z-]+$`),
      );
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
    expect(getFighterConfig('wizard').name).toBe('魔法胖橘貓');
    expect(() => getFighterConfig('no-such-cat')).toThrow(/Unknown fighter id/);
  });

  it('has a pose number for every pose of every fighter', () => {
    // A missing entry resolves to `undefined`, which becomes `assets/poses/x/aN.png`
    // and 404s — the fighter would simply be invisible for that pose.
    for (const fighter of FIGHTERS) {
      for (const pose of POSE_NAMES) {
        const number = poseNumber(fighter.id, pose);
        expect(Number.isInteger(number), `${fighter.id}.${pose}`).toBe(true);
        expect(number, `${fighter.id}.${pose}`).toBeGreaterThanOrEqual(1);
        expect(number, `${fighter.id}.${pose}`).toBeLessThanOrEqual(30);
      }
    }
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

  it('keeps total stat points within the roster’s 16..19 band', () => {
    // Characterizing the roster as it stands, not imposing a budget it never had.
    // The guard exists so that a newly added fighter has to be a deliberate
    // outlier rather than an accident.
    const totals = FIGHTERS.map((fighter) =>
      STAT_FIELDS.reduce((sum, field) => sum + fighter[field], 0),
    );
    expect(Math.min(...totals)).toBe(16);
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

  it('defines a whole-tick startup/active/recovery window for every attack', () => {
    // Authored in ticks, so this is no longer a question of rounding surviving —
    // it is that a window is a countable number of frames. A fractional one would
    // decrement past its boundary without ever equalling it.
    for (const spec of ALL_SPECS) {
      for (const field of ['startup', 'active', 'recovery'] as const) {
        expect(Number.isInteger(spec[field]), `${spec.id}.${field} = ${spec[field]}`).toBe(true);
        expect(spec[field], `${spec.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every optional duration a whole number of ticks too', () => {
    for (const spec of ALL_SPECS) {
      for (const field of ['cooldown', 'lifetime', 'telegraph', 'stunLockout'] as const) {
        const value = spec[field];
        if (value === undefined) continue;
        expect(Number.isInteger(value), `${spec.id}.${field} = ${value}`).toBe(true);
        expect(value, `${spec.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it('deals positive damage with reach and a hitstun advantage over blockstun', () => {
    for (const spec of CONTACT_SPECS) {
      expect(spec.damage, `${spec.id}.damage`).toBeGreaterThan(0);
      expect(spec.reach, `${spec.id}.reach`).toBeGreaterThan(0);
      // Blocking must always be better than being hit, or blocking is pointless.
      expect(spec.blockstun, `${spec.id}`).toBeLessThan(spec.hitstun);
    }
  });

  it('knocks the defender backwards and never downwards', () => {
    for (const spec of CONTACT_SPECS) {
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
  it('gives every fighter a 236, a 214 and a function move', () => {
    for (const fighter of FIGHTERS) {
      expect(fighter.specials.quarterForward.id, fighter.id).toBeTruthy();
      expect(fighter.specials.quarterBack.id, fighter.id).toBeTruthy();
      expect(fighter.specials.functionMove.id, fighter.id).toBeTruthy();
    }
  });

  it('gives exactly one fighter a fourth special', () => {
    // A 623 is a reversal, and handing one to everybody would flatten the roster.
    const withDragonPunch = FIGHTERS.filter((f) => f.specials.dragonPunch);
    expect(withDragonPunch.map((f) => f.id)).toEqual(['scared']);
  });

  it('gives every special a cooldown and every ultimate none', () => {
    for (const fighter of FIGHTERS) {
      for (const spec of allSpecials(fighter)) {
        expect(spec.cooldown, `${fighter.id}.${spec.id}`).toBeGreaterThan(0);
      }
      // Ultimates are gated by the 100-point meter, not by a timer.
      expect(fighter.ultimate.cooldown, `${fighter.id}.ultimate`).toBeUndefined();
    }
  });

  it('grants no meter for landing an ultimate, and some for every special that connects', () => {
    for (const fighter of FIGHTERS) {
      expect(fighter.ultimate.energyOnHit, `${fighter.id}.ultimate`).toBe(0);
      for (const spec of allSpecials(fighter)) {
        // A utility move earns on completion instead, so it is exempt.
        if (spec.damage === 0) continue;
        expect(spec.energyOnHit, `${fighter.id}.${spec.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('pays every no-contact utility move in meter, since it can never hit', () => {
    // A move with no damage and no meter would be strictly worse than doing
    // nothing, which is a data mistake rather than a design choice.
    for (const fighter of FIGHTERS) {
      for (const spec of allSpecials(fighter)) {
        if (spec.damage > 0) continue;
        const pays = (spec.meterOnComplete ?? 0) > 0;
        const defends = Boolean(spec.armor) || (spec.invulnerable?.length ?? 0) > 0;
        expect(pays || defends, `${fighter.id}.${spec.id} does nothing`).toBe(true);
      }
    }
  });

  it('makes every ultimate hit harder and stun longer than the fighter’s own specials', () => {
    for (const fighter of FIGHTERS) {
      for (const spec of allSpecials(fighter)) {
        expect(fighter.ultimate.damage, `${fighter.id} vs ${spec.id}`).toBeGreaterThan(spec.damage);
        expect(fighter.ultimate.hitstun, `${fighter.id} vs ${spec.id}`).toBeGreaterThan(spec.hitstun);
      }
    }
  });

  it('tags every ultimate with an `ultimate-` kind and no special with one', () => {
    for (const fighter of FIGHTERS) {
      expect(fighter.ultimate.kind.startsWith('ultimate-'), `${fighter.id}.ultimate`).toBe(true);
      for (const spec of allSpecials(fighter)) {
        expect(spec.kind.startsWith('ultimate-'), `${fighter.id}.${spec.id}`).toBe(false);
      }
    }
  });

  it('keeps a multi-hit damage list summing to the total it declares', () => {
    for (const spec of ALL_SPECS) {
      if (!spec.hits) continue;
      const sum = spec.hits.reduce((a, b) => a + b, 0);
      expect(sum, `${spec.id}.hits`).toBe(spec.damage);
      expect(spec.rehitTicks, `${spec.id}.rehitTicks`).toBeGreaterThan(0);
    }
  });

  it('keeps every armour and invulnerability window inside the move it belongs to', () => {
    // A window that opens after the move has ended can never fire, and one that
    // runs backwards is silently never true.
    for (const spec of ALL_SPECS) {
      const total = spec.startup + spec.active + spec.recovery;
      const windows = [...(spec.invulnerable ?? []), ...(spec.armor ? [spec.armor] : [])];
      for (const window of windows) {
        expect(window.from, `${spec.id} window.from`).toBeGreaterThanOrEqual(1);
        expect(window.to, `${spec.id} window.to`).toBeGreaterThanOrEqual(window.from);
        expect(window.to, `${spec.id} window.to vs ${total} total`).toBeLessThanOrEqual(total);
      }
    }
  });

  it('gives every throw a hard knockdown and every hard knockdown a throw’s reach', () => {
    for (const spec of ALL_SPECS) {
      if (!spec.unblockable) continue;
      expect(spec.hardKnockdown, `${spec.id}`).toBe(true);
      // An unblockable at fireball range would have no counterplay at all.
      expect(spec.reach, `${spec.id}.reach`).toBeLessThan(150);
    }
  });

  it('supplies the fields each attack kind needs at runtime', () => {
    // CombatSystem reads these per kind; a missing field falls back to a default
    // that silently changes the move rather than failing loudly.
    for (const spec of ALL_SPECS) {
      if (['sonic', 'water', 'salad'].includes(spec.kind)) {
        expect(spec.projectileSpeed, `${spec.id}.projectileSpeed`).toBeGreaterThan(0);
        expect(spec.lifetime, `${spec.id}.lifetime`).toBeGreaterThan(0);
      }
      if (['zone', 'ultimate-salad'].includes(spec.kind)) {
        expect(spec.telegraph, `${spec.id}.telegraph`).toBeGreaterThan(0);
      }
      if (spec.kind === 'aura') {
        expect(spec.stunLockout, `${spec.id}.stunLockout`).toBeGreaterThan(0);
      }
    }
  });

  it('draws every ultimate from the eight presentation kinds', () => {
    // Twelve fighters over eight kinds, so they no longer map one-to-one — the
    // kind picks how the ultimate is staged, not who owns it. What still has to
    // hold is that none of them names a kind the simulation cannot present.
    const known = new Set([
      'ultimate-alien', 'ultimate-freeze', 'ultimate-magic', 'ultimate-ok',
      'ultimate-salad', 'ultimate-social', 'ultimate-sonic', 'ultimate-water',
    ]);
    for (const fighter of FIGHTERS) {
      expect(known.has(fighter.ultimate.kind), `${fighter.id}: ${fighter.ultimate.kind}`).toBe(true);
    }
    // And that all eight are still in use; an unused one is dead presentation code.
    expect(new Set(FIGHTERS.map((f) => f.ultimate.kind)).size).toBe(8);
  });
});
