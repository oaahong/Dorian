export type AttackType='High'|'Mid'|'Low'|'Overhead'|'Air'|'Throw'|'Projectile';
export type BoxType='Hurtbox'|'Hitbox'|'Pushbox'|'ThrowBox'|'ThrowHurtbox'|'ProjectileHitbox'|'TriggerBox'|'ZoneHitbox';
export interface RectBox { x:number;y:number;w:number;h:number;type:BoxType; }
export interface FrameBoxData extends RectBox { from:number;to:number; }
export interface ArmorSpec { kind:'Strike'|'Projectile'|'AnyStrike'; hits:number; from:number;to:number; }
export interface InvulnerabilitySpec { kind:'Strike'|'Projectile'|'Throw'|'AirAttack'|'Low'|'Full'; from:number;to:number; }
export interface CancelRule { into:'special'|'rush'|'ultimate'; condition:'onHit'|'onBlock'|'onHitOrBlock'|'always'; fromFrame?:number; }
