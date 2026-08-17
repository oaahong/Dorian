import type {MoveData} from '../combat/MoveData';
const base=(x:Partial<MoveData>&Pick<MoveData,'id'|'name'|'pose'|'startup'|'active'|'recovery'|'damage'|'hitstun'|'blockstun'|'attackType'|'range'>):MoveData=>({kind:'strike',hitstopAttacker:3,hitstopVictim:4,pushbackX:18,meterGainHit:4,meterGainBlock:1,meterGainReceive:2,cancelRules:[],...x});
export const COMMON_MOVES={
 standingLight:base({id:'standingLight',name:'Standing Light',pose:8,startup:4,active:2,recovery:8,damage:4,hitstun:11,blockstun:7,attackType:'Mid',range:92,cancelRules:[{into:'special',condition:'onHitOrBlock'},{into:'rush',condition:'onHitOrBlock'}]}),
 standingHeavy:base({id:'standingHeavy',name:'Standing Heavy',pose:9,startup:9,active:3,recovery:18,damage:9,hitstun:17,blockstun:10,attackType:'Mid',range:118,hitstopAttacker:5,hitstopVictim:7,meterGainHit:7,meterGainReceive:4,cancelRules:[{into:'special',condition:'onHit'}]}),
 crouchingLight:base({id:'crouchingLight',name:'Crouching Light',pose:10,startup:5,active:2,recovery:9,damage:4,hitstun:10,blockstun:6,attackType:'Low',range:96}),
 crouchingHeavy:base({id:'crouchingHeavy',name:'Crouching Heavy',pose:11,startup:10,active:4,recovery:21,damage:10,hitstun:18,blockstun:9,attackType:'Low',range:128,knockdown:true,hitstopAttacker:5,hitstopVictim:7,meterGainHit:7,meterGainReceive:4}),
 jumpLight:base({id:'jumpLight',name:'Jump Light',pose:12,startup:4,active:6,recovery:8,damage:4,hitstun:11,blockstun:7,attackType:'Air',range:96}),
 jumpHeavy:base({id:'jumpHeavy',name:'Jump Heavy',pose:13,startup:7,active:7,recovery:14,damage:8,hitstun:16,blockstun:9,attackType:'Air',range:118,hitstopAttacker:5,hitstopVictim:6,meterGainHit:7,meterGainReceive:4}),
 throw:base({id:'throw',name:'Throw',pose:18,kind:'commandThrow',startup:5,active:3,recovery:20,damage:12,hitstun:20,blockstun:0,attackType:'Throw',range:76,hardKnockdown:true,meterGainHit:8,meterGainReceive:5}),
 memeImpact:base({id:'memeImpact',name:'Meme Impact',pose:9,kind:'burst',startup:26,active:4,recovery:28,damage:13,hitstun:22,blockstun:14,attackType:'Mid',range:150,armor:{kind:'Strike',hits:2,from:8,to:24},pushbackX:90,hitstopAttacker:7,hitstopVictim:9,meterGainHit:8,meterGainReceive:5}),
};
