import { describe, it, expect } from 'vitest';
import { allSpecials } from '../../fighters/FighterConfig';
import { FIGHTERS } from '../../fighters/fighterData';
import { HEAVY_ATTACK, LIGHT_ATTACK } from '../../combat/AttackSpec';
import { HEAVY_SPEC, LIGHT_SPEC, THROW_SPEC, allSpecs, getSpec, toTickSpec } from '../attackSpecs';
import { DEFAULT_SPECIAL_COOLDOWN_TICKS, DEFAULT_STUN_LOCKOUT_TICKS } from '../constants';

/**
 * Frame data and the simulation now agree on their unit: both count ticks. What
 * toTickSpec still earns its name for is resolving the optional fields, so the hot
 * path never meets an `undefined` and two clients cannot fall back differently.
 * See docs/sim-spec.md §6.
 */

describe('toTickSpec', () => {
  it('leaves the shared normals timings exactly as authored', () => {
    // These are the same numbers the millisecond authoring used to round to, which
    // is why the golden replays did not move when the unit changed.
    expect(LIGHT_SPEC.startupTicks).toBe(5);
    expect(LIGHT_SPEC.activeTicks).toBe(5);
    expect(LIGHT_SPEC.recoveryTicks).toBe(10);

    expect(HEAVY_SPEC.startupTicks).toBe(11);
    expect(HEAVY_SPEC.activeTicks).toBe(7);
    expect(HEAVY_SPEC.recoveryTicks).toBe(18);
  });

  it('carries the non-timing fields across unchanged', () => {
    expect(LIGHT_SPEC.id).toBe(LIGHT_ATTACK.id);
    expect(LIGHT_SPEC.kind).toBe(LIGHT_ATTACK.kind);
    expect(LIGHT_SPEC.damage).toBe(LIGHT_ATTACK.damage);
    expect(LIGHT_SPEC.reach).toBe(LIGHT_ATTACK.reach);
    expect(HEAVY_SPEC.knockbackX).toBe(HEAVY_ATTACK.knockbackX);
    expect(HEAVY_SPEC.knockbackY).toBe(HEAVY_ATTACK.knockbackY);
  });

  it('carries every timing field of every roster attack through untouched', () => {
    for (const fighter of FIGHTERS) {
      for (const source of [...allSpecials(fighter), fighter.ultimate]) {
        const spec = toTickSpec(source);
        expect(spec.startupTicks, `${source.id}`).toBe(source.startup);
        expect(spec.activeTicks, `${source.id}`).toBe(source.active);
        expect(spec.recoveryTicks, `${source.id}`).toBe(source.recovery);
        expect(spec.hitstunTicks, `${source.id}`).toBe(source.hitstun);
        expect(spec.blockstunTicks, `${source.id}`).toBe(source.blockstun);
      }
    }
  });

  it('resolves the documented defaults for absent optional timings', () => {
    // CombatSystem used `?? 1500` / `?? 2800` / `?? 900` inline. Resolving them
    // once here means the simulation never has to remember a fallback.
    const noCooldown = toTickSpec({ ...LIGHT_ATTACK, cooldown: undefined });
    expect(noCooldown.cooldownTicks).toBe(DEFAULT_SPECIAL_COOLDOWN_TICKS);

    const aura = toTickSpec({ ...LIGHT_ATTACK, kind: 'aura', stunLockout: undefined });
    expect(aura.stunLockoutTicks).toBe(DEFAULT_STUN_LOCKOUT_TICKS);
  });

  it('honours a declared cooldown over the default', () => {
    const spec = toTickSpec({ ...LIGHT_ATTACK, cooldown: 120 });
    expect(spec.cooldownTicks).toBe(120);
  });

  it('defaults chipRatio to zero so an unblockable-through move deals no chip', () => {
    expect(toTickSpec({ ...LIGHT_ATTACK, chipRatio: undefined }).chipRatio).toBe(0);
  });

  it('gives every attack a total duration of at least one tick per phase', () => {
    for (const spec of allSpecs()) {
      expect(spec.startupTicks, spec.id).toBeGreaterThan(0);
      expect(spec.activeTicks, spec.id).toBeGreaterThan(0);
      expect(spec.recoveryTicks, spec.id).toBeGreaterThan(0);
    }
  });
});

describe('spec registry', () => {
  it('registers the shared normals plus every special and ultimate on the roster', () => {
    const rosterSpecs = FIGHTERS.reduce(
      (total, fighter) => total + allSpecials(fighter).length + 1,
      0,
    );
    // Light, heavy and the universal throw are shared by everybody.
    expect(allSpecs()).toHaveLength(3 + rosterSpecs);
  });

  it('resolves every id the roster references', () => {
    for (const fighter of FIGHTERS) {
      for (const spec of [...allSpecials(fighter), fighter.ultimate]) {
        expect(getSpec(spec.id).id).toBe(spec.id);
      }
    }
    expect(getSpec('light')).toBe(LIGHT_SPEC);
    expect(getSpec('heavy')).toBe(HEAVY_SPEC);
    expect(getSpec('throw')).toBe(THROW_SPEC);
  });

  it('throws on an unknown id rather than returning undefined', () => {
    // A silent undefined here would surface as a desync, not a crash.
    expect(() => getSpec('no-such-attack')).toThrow(/Unknown attack spec/);
  });

  it('returns the identical object for repeated lookups', () => {
    expect(getSpec('alien-beam')).toBe(getSpec('alien-beam'));
  });
});
