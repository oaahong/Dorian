import type {
  ArmorWindow,
  AttackKind,
  AttackSpec,
  AttackType,
  CancelRule,
  InvulnerabilityWindow,
} from '../combat/AttackSpec';
import {
  CROUCH_HEAVY_ATTACK,
  MEME_IMPACT,
  MEME_PARRY,
  MEME_RUSH,
  CROUCH_LIGHT_ATTACK,
  HEAVY_ATTACK,
  JUMP_HEAVY_ATTACK,
  JUMP_LIGHT_ATTACK,
  LIGHT_ATTACK,
  THROW_ATTACK,
} from '../combat/AttackSpec';
import { allChargeLevels } from '../fighters/chargeSpecials';
import { allSpecials } from '../fighters/FighterConfig';
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
 * See docs/gameplay/sim-spec.md §6.
 */
export interface TickSpec {
  id: string;
  name: string;
  kind: AttackKind;
  /** Always resolved; an unmarked move is a `mid`. */
  attackType: AttackType;

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
  /** How long a zone lingers after triggering; falls back to `activeTicks`. */
  zoneDurationTicks: number;

  /**
   * Damage of each hit, always at least one entry — a single-hit attack resolves
   * to `[damage]`. Having one shape for both means the hit path never branches on
   * whether an attack happens to be multi-hit.
   */
  hits: number[];
  rehitTicks: number;
  invulnerable: readonly InvulnerabilityWindow[];
  armor: ArmorWindow | null;
  unblockable: boolean;
  hardKnockdown: boolean;
  /** Meter awarded when the move finishes recovery. Zero for most attacks. */
  meterOnComplete: number;
  /** How many projectiles a summon puts out. One for everything else. */
  projectileCount: number;
  selfStatus: { kind: 'install'; ticks: number } | null;
  hitStatus: { kind: 'slow'; ticks: number } | null;
  /** Cosmetic: the render layer trails fading copies while this attack runs. */
  afterimage: boolean;
  /** Meter spent to start the move. Zero for everything that is free. */
  meterCost: number;
  /** Always resolved; an empty list means the move cannot be cancelled. */
  cancels: readonly CancelRule[];
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
    attackType: spec.attackType ?? 'mid',

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
    zoneDurationTicks: spec.zoneDuration ?? spec.active,

    hits: spec.hits ?? [spec.damage],
    rehitTicks: spec.rehitTicks ?? 0,
    invulnerable: spec.invulnerable ?? EMPTY_WINDOWS,
    armor: spec.armor ?? null,
    unblockable: spec.unblockable ?? false,
    hardKnockdown: spec.hardKnockdown ?? false,
    meterOnComplete: spec.meterOnComplete ?? 0,
    projectileCount: spec.projectileCount ?? 1,
    selfStatus: spec.selfStatus ?? null,
    hitStatus: spec.hitStatus ?? null,
    afterimage: spec.afterimage ?? false,
    meterCost: spec.meterCost ?? 0,
    cancels: spec.cancels ?? EMPTY_CANCELS,
  };
}

/** Shared so every single-hit spec points at the same empty list rather than its own. */
const EMPTY_WINDOWS: readonly InvulnerabilityWindow[] = Object.freeze([]);
const EMPTY_CANCELS: readonly CancelRule[] = Object.freeze([]);

export const LIGHT_SPEC: TickSpec = toTickSpec(LIGHT_ATTACK);
export const HEAVY_SPEC: TickSpec = toTickSpec(HEAVY_ATTACK);
export const CROUCH_LIGHT_SPEC: TickSpec = toTickSpec(CROUCH_LIGHT_ATTACK);
export const CROUCH_HEAVY_SPEC: TickSpec = toTickSpec(CROUCH_HEAVY_ATTACK);
export const JUMP_LIGHT_SPEC: TickSpec = toTickSpec(JUMP_LIGHT_ATTACK);
export const JUMP_HEAVY_SPEC: TickSpec = toTickSpec(JUMP_HEAVY_ATTACK);
export const THROW_SPEC: TickSpec = toTickSpec(THROW_ATTACK);

/**
 * The three universal meme moves. Shared by the whole roster, like the normals,
 * and named individually because the state machine reaches for each by hand.
 */
export const RUSH_SPEC: TickSpec = toTickSpec(MEME_RUSH);
export const PARRY_SPEC: TickSpec = toTickSpec(MEME_PARRY);
export const IMPACT_SPEC: TickSpec = toTickSpec(MEME_IMPACT);

/**
 * The six normals, indexed the way the state machine asks for them: by the stance
 * the fighter is in and the button they pressed.
 *
 * A table rather than a chain of ifs because every stance must resolve to *some*
 * normal — leaving one out would be a button that silently does nothing in one
 * stance, which is the kind of gap that is only ever found by a player.
 */
export const NORMALS: Record<'stand' | 'crouch' | 'air', Record<'light' | 'heavy', TickSpec>> = {
  stand: { light: LIGHT_SPEC, heavy: HEAVY_SPEC },
  crouch: { light: CROUCH_LIGHT_SPEC, heavy: CROUCH_HEAVY_SPEC },
  air: { light: JUMP_LIGHT_SPEC, heavy: JUMP_HEAVY_SPEC },
};

const REGISTRY = new Map<string, TickSpec>();

/**
 * Add a spec to the registry, resolving it on the way in.
 *
 * The registry is how the simulation turns the `specId` on a running attack back
 * into frame data, and it has to answer for the *defender's* attack as well as
 * the attacker's — invulnerability and armour are windows on the move the
 * defender is in the middle of. That is why registration is a named operation
 * rather than a module-load side effect: a spec that exists but was never
 * registered resolves to a throw at the worst possible moment.
 *
 * Returns the resolved spec so a caller can register and keep it in one step.
 */
export function registerSpec(spec: AttackSpec): TickSpec {
  const resolved = toTickSpec(spec);
  REGISTRY.set(resolved.id, resolved);
  return resolved;
}

for (const spec of [
  LIGHT_SPEC,
  HEAVY_SPEC,
  CROUCH_LIGHT_SPEC,
  CROUCH_HEAVY_SPEC,
  JUMP_LIGHT_SPEC,
  JUMP_HEAVY_SPEC,
  THROW_SPEC,
  RUSH_SPEC,
  PARRY_SPEC,
  IMPACT_SPEC,
]) {
  REGISTRY.set(spec.id, spec);
}
for (const fighter of FIGHTERS) {
  for (const source of [...allSpecials(fighter), fighter.ultimate]) registerSpec(source);
}
for (const source of allChargeLevels()) registerSpec(source);

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
