import type { AttackKind, AttackSpec } from '../combat/AttackSpec';
import { HEAVY_ATTACK, LIGHT_ATTACK } from '../combat/AttackSpec';
import { FIGHTERS } from '../fighters/fighterData';
import {
  DEFAULT_SPECIAL_COOLDOWN_MS,
  DEFAULT_STUN_LOCKOUT_MS,
  msToTicks,
} from './constants';

/**
 * Frame data, converted from authored milliseconds to whole ticks once at module
 * load.
 *
 * Doing the rounding here rather than per frame means the hot path never divides
 * by a frame delta, and both clients start from byte-identical windows. It also
 * resolves the `?? 1500` / `?? 2800` style fallbacks that used to be scattered
 * through CombatSystem, so the simulation never has to remember a default.
 *
 * Rounding shifts some windows by a few milliseconds (LIGHT startup goes from
 * 90 ms to 5 ticks = 83.3 ms). That is the deliberate one-off balance change
 * called out in the migration plan.
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

  /** Always resolved; falls back to DEFAULT_SPECIAL_COOLDOWN_MS. */
  cooldownTicks: number;
  /** Always resolved; 0 means a blocked hit deals nothing. */
  chipRatio: number;
  energyOnHit: number;
  energyOnReceive: number;

  projectileSpeed: number;
  lifetimeTicks: number;
  telegraphTicks: number;
  /** Only meaningful for `aura`; resolved to DEFAULT_STUN_LOCKOUT_MS. */
  stunLockoutTicks: number;
}

/** Matches the inline fallbacks in the original CombatSystem. */
const DEFAULT_PROJECTILE_SPEED = 600;
const DEFAULT_PROJECTILE_LIFETIME_MS = 900;
const DEFAULT_ZONE_TELEGRAPH_MS = 450;

export function toTickSpec(spec: AttackSpec): TickSpec {
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,

    startupTicks: msToTicks(spec.startupMs),
    activeTicks: msToTicks(spec.activeMs),
    recoveryTicks: msToTicks(spec.recoveryMs),

    damage: spec.damage,
    hitstunTicks: msToTicks(spec.hitstunMs),
    blockstunTicks: msToTicks(spec.blockstunMs),
    knockbackX: spec.knockbackX,
    knockbackY: spec.knockbackY,
    reach: spec.reach,

    cooldownTicks: msToTicks(spec.cooldownMs ?? DEFAULT_SPECIAL_COOLDOWN_MS),
    chipRatio: spec.chipRatio ?? 0,
    energyOnHit: spec.energyOnHit,
    energyOnReceive: spec.energyOnReceive,

    projectileSpeed: spec.projectileSpeed ?? DEFAULT_PROJECTILE_SPEED,
    lifetimeTicks: msToTicks(spec.lifetimeMs ?? DEFAULT_PROJECTILE_LIFETIME_MS),
    telegraphTicks: msToTicks(spec.telegraphMs ?? DEFAULT_ZONE_TELEGRAPH_MS),
    stunLockoutTicks: msToTicks(spec.stunLockoutMs ?? DEFAULT_STUN_LOCKOUT_MS),
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
