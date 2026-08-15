import type { AttackSpec } from '../combat/AttackSpec';

export interface FighterPalette {
  primary: number;
  secondary: number;
  accent: number;
}

export interface FighterConfig {
  id: string;
  number: string;
  name: string;
  shortName: string;
  archetype: string;
  tagline: string;
  hpStat: number;
  attackStat: number;
  speedStat: number;
  rangeStat: number;
  controlStat: number;
  cardTexture: string;
  special: AttackSpec;
  ultimate: AttackSpec;
  palette: FighterPalette;
}
