export type AttackKind =
  | 'melee'
  | 'sonic'
  | 'water'
  | 'dash'
  | 'aura'
  | 'salad'
  | 'slide'
  | 'beam'
  | 'zone'
  | 'ultimate-sonic'
  | 'ultimate-water'
  | 'ultimate-ok'
  | 'ultimate-social'
  | 'ultimate-salad'
  | 'ultimate-freeze'
  | 'ultimate-alien'
  | 'ultimate-magic';

export interface AttackSpec {
  id: string;
  name: string;
  kind: AttackKind;
  startupMs: number;
  activeMs: number;
  recoveryMs: number;
  damage: number;
  hitstunMs: number;
  blockstunMs: number;
  knockbackX: number;
  knockbackY: number;
  reach: number;
  cooldownMs?: number;
  chipRatio?: number;
  energyOnHit: number;
  energyOnReceive: number;
  projectileSpeed?: number;
  lifetimeMs?: number;
  telegraphMs?: number;
  stunLockoutMs?: number;
}

export const LIGHT_ATTACK: AttackSpec = {
  id: 'light',
  name: 'LIGHT',
  kind: 'melee',
  startupMs: 90,
  activeMs: 90,
  recoveryMs: 160,
  damage: 5,
  hitstunMs: 180,
  blockstunMs: 90,
  knockbackX: 150,
  knockbackY: -40,
  reach: 78,
  chipRatio: 0,
  energyOnHit: 5,
  energyOnReceive: 3,
};

export const HEAVY_ATTACK: AttackSpec = {
  id: 'heavy',
  name: 'HEAVY',
  kind: 'melee',
  startupMs: 180,
  activeMs: 120,
  recoveryMs: 300,
  damage: 9,
  hitstunMs: 300,
  blockstunMs: 150,
  knockbackX: 255,
  knockbackY: -110,
  reach: 104,
  chipRatio: 0,
  energyOnHit: 8,
  energyOnReceive: 5,
};
