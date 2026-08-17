export type CombatAction='light'|'heavy'|'specialH'|'special1'|'special2'|'special3'|'function'|'throw'|'commandThrow'|'ultimate'|'impact'|'parry'|'rush'|'dashForward'|'dashBack'|null;
export interface FighterIntent { moveX:-1|0|1;crouch:boolean;jump:boolean;guard:boolean;action:CombatAction;specialHeld:boolean;specialPressed:boolean;specialReleased:boolean;ultimateHeld:boolean;ultimatePressed:boolean;ultimateReleased:boolean; }
export interface Controller { tick(frame:number,facing:1|-1,airborne:boolean):FighterIntent; reset():void; }
export const neutralIntent=():FighterIntent=>({moveX:0,crouch:false,jump:false,guard:false,action:null,specialHeld:false,specialPressed:false,specialReleased:false,ultimateHeld:false,ultimatePressed:false,ultimateReleased:false});
