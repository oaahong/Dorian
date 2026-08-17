import type { AttackKind, AttackSpec } from '../combat/AttackSpec';
import { HEAVY_ATTACK, LIGHT_ATTACK } from '../combat/AttackSpec';
import { FIGHTERS } from '../fighters/fighterData';
import {
  DEFAULT_SPECIAL_COOLDOWN_TICKS,
  DEFAULT_STUN_LOCKOUT_TICKS,
} from './constants';

/**
 * An AttackSpec with every optional field resolved, built once at module load.
 *
 * AttackSpec is already authored in ticks, so this no longer converts anything —
 * what it still does is settle the `?? 1500` / `?? 2800` style fallbacks that used
 * to be scattered through CombatSystem, so the simulation never has to remember a
 * default and two clients cannot disagree about one. The `Ticks` suffix marks the
 * resolved side of that: an AttackSpec field may be absent, the matching TickSpec
 * field never is.
 *
 * See docs/sim-spec.md §6.
 */
export interface TickSpec {
  id: string;
  name: string;
  kind: AttackKind;

  startupTicks: number;
  activeTicks: number;
  recoveryTicks: number;

  damage: number;
  hitstunTicks: number;
  blockstunTicks: number;
  knockbackX: number;
  knockbackY: number;
  reach: number;

  /** Always resolved; falls back to DEFAULT_SPECIAL_COOLDOWN_TICKS. */
  cooldownTicks: number;
  /** Always resolved; 0 means a blocked hit deals nothing. */
  chipRatio: number;
  energyOnHit: number;
  energyOnReceive: number;

  projectileSpeed: number;
  lifetimeTicks: number;
  telegraphTicks: number;
  /** Only meaningful for `aura`; resolved to DEFAULT_STUN_LOCKOUT_TICKS. */
  stunLockoutTicks: number;
}

/** Matches the inline fallbacks in the original CombatSystem, in ticks. */
const DEFAULT_PROJECTILE_SPEED = 600;
const DEFAULT_PROJECTILE_LIFETIME_TICKS = 54; // was 900 ms
const DEFAULT_ZONE_TELEGRAPH_TICKS = 27; // was 450 ms

export function toTickSpec(spec: AttackSpec): TickSpec {
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,

    startupTicks: spec.startup,
    activeTicks: spec.active,
    recoveryTicks: spec.recovery,

    damage: spec.damage,
    hitstunTicks: spec.hitstun,
    blockstunTicks: spec.blockstun,
    knockbackX: spec.knockbackX,
    knockbackY: spec.knockbackY,
    reach: spec.reach,

    cooldownTicks: spec.cooldown ?? DEFAULT_SPECIAL_COOLDOWN_TICKS,
    chipRatio: spec.chipRatio ?? 0,
    energyOnHit: spec.energyOnHit,
    energyOnReceive: spec.energyOnReceive,

    projectileSpeed: spec.projectileSpeed ?? DEFAULT_PROJECTILE_SPEED,
    lifetimeTicks: spec.lifetime ?? DEFAULT_PROJECTILE_LIFETIME_TICKS,
    telegraphTicks: spec.telegraph ?? DEFAULT_ZONE_TELEGRAPH_TICKS,
    stunLockoutTicks: spec.stunLockout ?? DEFAULT_STUN_LOCKOUT_TICKS,
  };
}

export const LIGHT_SPEC: TickSpec = toTickSpec(LIGHT_ATTACK);
export const HEAVY_SPEC: TickSpec = toTickSpec(HEAVY_ATTACK);

const REGISTRY = new Map<string, TickSpec>();
for (const spec of [LIGHT_SPEC, HEAVY_SPEC]) REGISTRY.set(spec.id, spec);
for (const fighter of FIGHTERS) {
  for (const source of [fighter.special, fighter.ultimate]) {
    REGISTRY.set(source.id, toTickSpec(source));
  }
}

/**
 * Resolve a spec by id. Throws rather than returning undefined: an attack that
 * silently resolves to nothing would surface as a desync between two clients
 * rather than as a crash on one.
 */
export function getSpec(id: string): TickSpec {
  const spec = REGISTRY.get(id);
  if (!spec) throw new Error(`Unknown attack spec: ${id}`);
  return spec;
}

export function allSpecs(): TickSpec[] {
  return [...REGISTRY.values()];
}
