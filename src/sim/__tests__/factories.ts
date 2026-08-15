import type { AttackKind } from '../../combat/AttackSpec';
import { LIGHT_SPEC } from '../attackSpecs';
import type { SimAttack } from '../types';

/**
 * Test fixtures for simulation state.
 *
 * SimAttack gains fields as the port progresses, and inline object literals in
 * every test file have to be edited each time. Building them here means a new
 * field is a one-line change.
 */
export function attackRuntime(overrides: Partial<SimAttack> = {}): SimAttack {
  return {
    specId: LIGHT_SPEC.id,
    kind: LIGHT_SPEC.kind as AttackKind,
    elapsedTicks: 0,
    activeJustStarted: false,
    crouching: false,
    airborne: false,
    hitMask: 0,
    presented: false,
    ...overrides,
  };
}
