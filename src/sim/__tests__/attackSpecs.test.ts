import { describe, it, expect } from 'vitest';
import { FIGHTERS } from '../../fighters/fighterData';
import { HEAVY_ATTACK, LIGHT_ATTACK } from '../../combat/AttackSpec';
import { HEAVY_SPEC, LIGHT_SPEC, allSpecs, getSpec, toTickSpec } from '../attackSpecs';
import { DEFAULT_SPECIAL_COOLDOWN_MS, DEFAULT_STUN_LOCKOUT_MS, msToTicks } from '../constants';

/**
 * Frame data is authored in milliseconds but the simulation counts ticks. The
 * conversion happens once, at module load, so no rounding happens in the hot path
 * and both clients get identical windows. See docs/sim-spec.md §6.
 */

describe('toTickSpec', () => {
  it('converts the shared normals to whole ticks', () => {
    expect(LIGHT_SPEC.startupTicks).toBe(5); // 90 ms
    expect(LIGHT_SPEC.activeTicks).toBe(5); // 90 ms
    expect(LIGHT_SPEC.recoveryTicks).toBe(10); // 160 ms

    expect(HEAVY_SPEC.startupTicks).toBe(11); // 180 ms
    expect(HEAVY_SPEC.activeTicks).toBe(7); // 120 ms
    expect(HEAVY_SPEC.recoveryTicks).toBe(18); // 300 ms
  });

  it('carries the non-timing fields across unchanged', () => {
    expect(LIGHT_SPEC.id).toBe(LIGHT_ATTACK.id);
    expect(LIGHT_SPEC.kind).toBe(LIGHT_ATTACK.kind);
    expect(LIGHT_SPEC.damage).toBe(LIGHT_ATTACK.damage);
    expect(LIGHT_SPEC.reach).toBe(LIGHT_ATTACK.reach);
    expect(HEAVY_SPEC.knockbackX).toBe(HEAVY_ATTACK.knockbackX);
    expect(HEAVY_SPEC.knockbackY).toBe(HEAVY_ATTACK.knockbackY);
  });

  it('converts every timing field of every roster attack', () => {
    for (const fighter of FIGHTERS) {
      for (const source of [fighter.special, fighter.ultimate]) {
        const spec = toTickSpec(source);
        expect(spec.startupTicks, `${source.id}`).toBe(msToTicks(source.startupMs));
        expect(spec.activeTicks, `${source.id}`).toBe(msToTicks(source.activeMs));
        expect(spec.recoveryTicks, `${source.id}`).toBe(msToTicks(source.recoveryMs));
        expect(spec.hitstunTicks, `${source.id}`).toBe(msToTicks(source.hitstunMs));
        expect(spec.blockstunTicks, `${source.id}`).toBe(msToTicks(source.blockstunMs));
      }
    }
  });

  it('resolves the documented defaults for absent optional timings', () => {
    // CombatSystem used `?? 1500` / `?? 2800` / `?? 900` inline. Resolving them
    // once here means the simulation never has to remember a fallback.
    const noCooldown = toTickSpec({ ...LIGHT_ATTACK, cooldownMs: undefined });
    expect(noCooldown.cooldownTicks).toBe(msToTicks(DEFAULT_SPECIAL_COOLDOWN_MS));

    const aura = toTickSpec({ ...LIGHT_ATTACK, kind: 'aura', stunLockoutMs: undefined });
    expect(aura.stunLockoutTicks).toBe(msToTicks(DEFAULT_STUN_LOCKOUT_MS));
  });

  it('honours a declared cooldown over the default', () => {
    const spec = toTickSpec({ ...LIGHT_ATTACK, cooldownMs: 2000 });
    expect(spec.cooldownTicks).toBe(msToTicks(2000));
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
  it('registers the two normals plus a special and ultimate per fighter', () => {
    expect(allSpecs()).toHaveLength(2 + FIGHTERS.length * 2);
  });

  it('resolves every id the roster references', () => {
    for (const fighter of FIGHTERS) {
      expect(getSpec(fighter.special.id).id).toBe(fighter.special.id);
      expect(getSpec(fighter.ultimate.id).id).toBe(fighter.ultimate.id);
    }
    expect(getSpec('light')).toBe(LIGHT_SPEC);
    expect(getSpec('heavy')).toBe(HEAVY_SPEC);
  });

  it('throws on an unknown id rather than returning undefined', () => {
    // A silent undefined here would surface as a desync, not a crash.
    expect(() => getSpec('no-such-attack')).toThrow(/Unknown attack spec/);
  });

  it('returns the identical object for repeated lookups', () => {
    expect(getSpec('collapse-special')).toBe(getSpec('collapse-special'));
  });
});
