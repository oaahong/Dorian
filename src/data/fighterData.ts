import type {FighterConfig,FighterDesignProfile,CpuCharacterRules,RuntimeCharacterSheetProfile} from '../fighters/FighterConfig';
import type {MoveData,UltimateMoveData,MoveKind} from '../combat/MoveData';

const poses=(id:string):RuntimeCharacterSheetProfile=>({fighterId:id,sourceTexture:`card-${id}`,poses:Object.fromEntries(Array.from({length:30},(_,i)=>[String(i+1),{path:`/assets/poses/${id}/${String(i+1).padStart(2,'0')}.png`}])) ,captionTrim:.17,backgroundRemoval:{threshold:30,edgeConnected:true,feather:1.2}});
const cpu=(desiredRange:number,aggression:number,retreat:number,projectileBias:number,throwBias:number,parryBias:number,armorBias:number,ultimateBias:number):CpuCharacterRules=>({desiredRange,aggression,retreat,projectileBias,throwBias,parryBias,armorBias,ultimateBias});
const design=(archetype:string,neutralPlan:string,pressurePlan:string,defensePlan:string,antiAirPlan:string,punishPlan:string,resourcePlan:string,preferredRange:FighterDesignProfile['preferredRange'],primaryStrengths:string[],weaknesses:string[],cpuRules:CpuCharacterRules):FighterDesignProfile=>({archetype,neutralPlan,pressurePlan,defensePlan,antiAirPlan,punishPlan,resourcePlan,preferredRange,primaryStrengths,weaknesses,cpuRules});
const move=(id:string,name:string,pose:number,kind:MoveKind,startup:number,active:number|number[],recovery:number,damage:number|number[],attackType:MoveData['attackType'],range:number,extra:Partial<MoveData>={}):MoveData=>({id,name,pose,kind,startup,active,recovery,damage,hitstun:18,blockstun:10,hitstopAttacker:5,hitstopVictim:7,pushbackX:28,attackType,range,meterGainHit:8,meterGainBlock:1,meterGainReceive:5,cancelRules:[],...extra});
const ult=(id:string,name:string,pose:number,runtimeId:string,startup:number,telegraph:number,maxDamage:number,extra:Partial<UltimateMoveData>={}):UltimateMoveData=>({id,name,pose,kind:'burst',runtimeId,startup,telegraph,active:5,recovery:36,damage:maxDamage,maxDamage,hitstun:28,blockstun:16,hitstopAttacker:8,hitstopVictim:10,pushbackX:64,attackType:'Mid',range:1280,meterGainHit:0,meterGainBlock:0,meterGainReceive:0,cancelRules:[],...extra});
const card=(n:number,slug:string)=>`/assets/cards/card-${String(n).padStart(2,'0')}-${slug}.png`;
const movement=(walk=4.2,backWalk=3.4,dash=9.2,backDash=8.2,jumpX=4.6,jumpY=-13)=>({walk,backWalk,dash,backDash,jumpX,jumpY});

export const FIGHTERS:FighterConfig[]=[
{
 id:'alien',name:'Alien Meow／訊號壞掉喵',shortName:'Alien Meow',ratings:{hp:2,attack:4,speed:3,range:5,control:4},archetype:'Mid-range Zoner',cardTexture:card(1,'alien'),sheetProfile:poses('alien'),movement:movement(4,3.2,8.7,8.1,4.3,-13),damageTakenScalar:1.08,palette:{primary:0x98ff00,accent:0x3cffb0},
 designProfile:design('Mid-range Zoner','Beam 控制水平空間','可樂 Zone 限制移動','靠距離與 Anti-Air','天線升頻','Beam 懲罰中距離大型 Whiff','遠程命中穩定積 Meter','far',['Beam','Zone','Anti-Air'],['近身弱','耐久低'],cpu(420,.46,.7,.85,.08,.08,.05,.72)),
 special1:move('alien-beam','斷訊掃描波',25,'beam',14,6,20,10,'Projectile',520,{hitstun:20,blockstun:13,projectileSpeed:13,projectileLife:52}),
 special2:move('alien-cola','宇宙可樂潑灑',26,'zone',18,5,23,8,'Projectile',310,{zoneDuration:48,moveSpeedMod:-.15,projectileSpeed:7,status:'slow',statusDuration:48}),
 functionMove:move('alien-antenna','天線升頻',24,'antiAir',7,4,24,8,'Mid',115,{invulnerability:[{kind:'AirAttack',from:1,to:5}],launchY:-8}),
 ultimate:ult('alien-ult','逼逼逼動感光波',28,'ALIEN_SCAN_RUNTIME',32,18,30)
},
{
 id:'doge',name:'Doge',shortName:'Doge',ratings:{hp:4,attack:4,speed:3,range:3,control:3},archetype:'All-round Burst',cardTexture:card(2,'doge'),sheetProfile:poses('doge'),movement:movement(4.2,3.5,9,8.3,4.7,-13),damageTakenScalar:.98,palette:{primary:0xe8b04d,accent:0xffe889},
 designProfile:design('All-round Burst','穩定中近距離','Armor Rush 逼近','Counter 與距離管理','Jump Heavy / Counter','Armor Rush 懲罰 Whiff','摸頭蓄怒換資源','dynamic',['Armor Rush','Counter','Install'],['讀錯 Counter 會被懲罰'],cpu(250,.64,.35,.12,.16,.28,.48,.8)),
 special1:move('doge-sideeye','側眼施壓',24,'counter',3,7,18,9,'Mid',105,{hitstun:22,status:'counterStance'}),
 special2:move('doge-bread','麵包化衝撞',25,'dashStrike',16,6,22,12,'Mid',190,{armor:{kind:'Strike',hits:1,from:6,to:15},pushbackX:55}),
 functionMove:move('doge-pet','摸頭蓄怒',26,'meterCharge',12,24,12,0,'Mid',0,{cooldown:180,meterGainOnComplete:18,statusDuration:24}),
 ultimate:ult('doge-ult','超級賽狗',28,'DOGE_INSTALL_RUNTIME',26,14,10,{status:'install',statusDuration:300})
},
{
 id:'ya',name:'YA鼠',shortName:'YA鼠',ratings:{hp:2,attack:2,speed:4,range:3,control:5},archetype:'Evasive Counter',cardTexture:card(3,'ya'),sheetProfile:poses('ya'),movement:movement(4.8,4,9.8,9.6,5.2,-13.5),damageTakenScalar:1.07,palette:{primary:0xf2a980,accent:0x8be0ff},
 designProfile:design('Evasive Counter','尷尬打招呼騷擾','安全 Blockstun 壓力','後撤與 Parry','空中輕攻擊','抓 Recovery 反打','Parry 積 Meter','dynamic',['Parry','後撤','壓力波'],['直接傷害低'],cpu(280,.48,.76,.35,.08,.72,.04,.64)),
 special1:move('ya-hi','尷尬打招呼',24,'projectile',10,4,17,6,'Mid',210,{blockstun:15,projectileSpeed:8,projectileLife:34}),
 special2:move('ya-retreat','倉皇後撤',25,'dashStrike',6,3,16,7,'Mid',130,{pushbackX:28}),
 functionMove:move('ya-glasses','眼鏡抬頭',26,'parry',2,6,18,0,'Mid',100,{status:'parryWindow'}),
 ultimate:ult('ya-ult','哈ㄗ咖西',28,'YA_PHOTO_RUNTIME',30,16,28)
},
{
 id:'tempura',name:'oh fucking 天婦羅尬哩涼',shortName:'天婦羅企鵝',ratings:{hp:3,attack:4,speed:2,range:4,control:3},archetype:'Summon / Swarm',cardTexture:card(4,'tempura'),sheetProfile:poses('tempura'),movement:movement(3.8,3.1,8.2,7.8,4.2,-12.6),damageTakenScalar:1,palette:{primary:0x111a29,accent:0xff5b3a},
 designProfile:design('Summon / Swarm','企鵝縱隊逼位','紙片封角','Projectile Armor','Jump Heavy','延遲召喚懲罰','多段命中積 Meter','far',['Summon','Screen Control'],['近身慢'],cpu(390,.45,.55,.78,.05,.05,.45,.72)),
 special1:move('tempura-penguins','企鵝縱隊',24,'summon',20,[1,1,1],24,[4,4,4],'Projectile',520,{projectileSpeed:7,projectileLife:90,rehitWindow:14}),
 special2:move('tempura-paper','紙片亂飛',25,'projectile',15,[1,1,1],23,[3,3,3],'Projectile',460,{projectileSpeed:10,projectileLife:60,projectileCount:5,maxHits:3,rehitWindow:8}),
 functionMove:move('tempura-paperread','讀報裝忙',26,'armor',4,1,18,0,'Mid',0,{armor:{kind:'Projectile',hits:1,from:5,to:14}}),
 ultimate:ult('tempura-ult','oh fucking 天婦羅尬哩涼！',28,'PENGUIN_CLONE_RUNTIME',30,16,30)
},
{
 id:'goblin',name:'哥布林也想談戀愛',shortName:'哥布林',ratings:{hp:4,attack:4,speed:2,range:2,control:4},archetype:'Close Pressure / Command Throw',cardTexture:card(5,'goblin'),sheetProfile:poses('goblin'),movement:movement(4,3.2,8.8,8,4,-12.8),damageTakenScalar:.98,palette:{primary:0x77ba55,accent:0xff6b9e},
 designProfile:design('Close Pressure','貼身猜拳','Strike / Command Throw','靠生命與 Stagger','Crouching Heavy','Command Throw 抓防守','LoveStun 逼選擇','close',['Command Throw','Stun Buildup'],['遠距離弱'],cpu(150,.82,.2,.05,.72,.05,.08,.78)),
 special1:move('goblin-choke','鎖喉告白',24,'commandThrow',7,2,30,16,'Throw',90,{hardKnockdown:true}),
 special2:move('goblin-heart','怦然心動',25,'burst',15,5,20,6,'Mid',145,{status:'loveStun',statusDuration:35}),
 functionMove:move('goblin-bangs','瀏海降臨',26,'install',12,1,12,0,'Mid',0,{status:'goblinInstall',statusDuration:180}),
 ultimate:ult('goblin-ult','長老您保重',28,'GOBLIN_INSTALL_RUNTIME',32,12,34,{recovery:45})
},
{
 id:'salad',name:'沙拉貓貓',shortName:'沙拉貓貓',ratings:{hp:5,attack:4,speed:1,range:4,control:3},archetype:'Tank Keep-away',cardTexture:card(6,'salad'),sheetProfile:poses('salad'),movement:movement(3.4,2.8,7.2,7,3.7,-12.2),damageTakenScalar:.92,palette:{primary:0xf5f2e7,accent:0x7bd34f},
 designProfile:design('Tank Keep-away','沙拉投射物','長 Disjoint 推回','耐久高','盤緣上撥','抓對手衝入','靠 Block / Heavy 積資源','mid',['高推回','耐久','Disjoint'],['速度慢'],cpu(330,.4,.6,.7,.05,.04,.18,.66)),
 special1:move('salad-no','我不想吃這個',24,'projectile',19,4,22,9,'Projectile',440,{projectileSpeed:8,projectileLife:65}),
 special2:move('salad-away','你拿遠一點',25,'strike',11,4,22,8,'Mid',185,{pushbackX:92}),
 functionMove:move('salad-aa','盤緣上撥',26,'antiAir',7,4,25,8,'Mid',130,{invulnerability:[{kind:'AirAttack',from:1,to:5}],launchY:-8}),
 ultimate:ult('salad-ult','菜就多練',28,'SALAD_BOWL_RUNTIME',31,16,31)
},
{
 id:'wizard',name:'魔法胖橘貓',shortName:'魔法胖橘貓',ratings:{hp:4,attack:3,speed:2,range:5,control:5},archetype:'Setup / Zone',cardTexture:card(7,'wizard'),sheetProfile:poses('wizard'),movement:movement(3.8,3,8,7.6,4.1,-12.6),damageTakenScalar:.98,palette:{primary:0xd78430,accent:0xb158ff},
 designProfile:design('Setup / Zone','先放法陣','Overhead 破蹲防','Zone 自保','木杖點天','Zone 命中接 Heavy','Zone 控場積資源','far',['Setup','Overhead','Zone'],['貼身啟動慢'],cpu(380,.42,.62,.76,.04,.08,.12,.75)),
 special1:move('wizard-circle','JPEG魔法陣',24,'zone',18,4,24,9,'Mid',330,{zoneDuration:48,status:'telegraph',statusDuration:24}),
 special2:move('wizard-hat','帽簷遮天',25,'dashStrike',18,4,24,10,'Overhead',165),
 functionMove:move('wizard-staff','木杖點天',26,'antiAir',8,5,22,8,'Mid',130,{invulnerability:[{kind:'AirAttack',from:1,to:4}],launchY:-8}),
 ultimate:ult('wizard-ult','喵蘇魯的召喚！',28,'CTHULHU_RUNTIME',31,18,30)
},
{
 id:'blade',name:'我的刀盾',shortName:'我的刀盾',ratings:{hp:5,attack:3,speed:2,range:2,control:4},archetype:'Armor Defense',cardTexture:card(8,'blade-shield'),sheetProfile:poses('blade'),movement:movement(3.7,3,8.3,7.5,4,-12.5),damageTakenScalar:.93,palette:{primary:0xa95d23,accent:0xe1d094},
 designProfile:design('Armor Defense','盾前壓','多段刀磨','Armor 吃單招','盾牌抬天','擋後反擊','Armor 吸收換優勢','close',['Armor','多段','防禦'],['Throw 弱點'],cpu(200,.58,.42,.1,.12,.05,.8,.7)),
 special1:move('blade-grind','鈍刀亂磨',24,'multiStrike',10,[3,3,4],22,[3,3,4],'Mid',120,{rehitWindow:4}),
 special2:move('blade-rush','龜殼舉盾衝',25,'dashStrike',14,5,22,11,'Mid',190,{armor:{kind:'Strike',hits:2,from:5,to:18}}),
 functionMove:move('blade-aa','盾牌抬天',26,'antiAir',6,5,20,7,'Mid',125,{invulnerability:[{kind:'AirAttack',from:1,to:6}],launchY:-7}),
 ultimate:ult('blade-ult','汪爆氣流斬',28,'DUAL_SWORD_RUNTIME',30,14,31,{armor:{kind:'Strike',hits:2,from:1,to:52}})
},
{
 id:'pink',name:'粉紅星星',shortName:'粉紅星星',ratings:{hp:3,attack:4,speed:3,range:3,control:3},archetype:'Awkward Burst',cardTexture:card(9,'pink-star'),sheetProfile:poses('pink'),movement:movement(4.4,3.6,9.2,8.8,4.7,-13),damageTakenScalar:1,palette:{primary:0xff668d,accent:0x5dbeff},
 designProfile:design('Awkward Burst','尖叫中距離','寫實臉 Overhead','怪位移','星尖上頂','大招抓 Recovery','命中快積資源','dynamic',['Sonic','Overhead','Burst'],['Recovery 偏大'],cpu(270,.62,.45,.4,.08,.08,.1,.73)),
 special1:move('pink-scream','尖叫嘴震',24,'projectile',12,6,20,8,'Projectile',260,{hitstun:18,blockstun:12,projectileSpeed:10,projectileLife:38}),
 special2:move('pink-real','突然寫實臉',25,'burst',20,5,28,12,'Overhead',155,{hitstun:21,blockstun:11}),
 functionMove:move('pink-aa','星尖上頂',26,'antiAir',6,5,25,8,'Mid',125,{invulnerability:[{kind:'AirAttack',from:1,to:4}],launchY:-8}),
 ultimate:ult('pink-ult','派甜心假面...露出',28,'REAL_FACE_RUNTIME',30,15,30)
},
{
 id:'sauce',name:'蘸醬胡渣狗',shortName:'蘸醬胡渣狗',ratings:{hp:4,attack:3,speed:3,range:4,control:4},archetype:'Attrition Rush',cardTexture:card(10,'sauce-dog'),sheetProfile:poses('sauce'),movement:movement(4.2,3.4,9,8.3,4.5,-12.9),damageTakenScalar:.98,palette:{primary:0xe9cf99,accent:0x9f5f34},
 designProfile:design('Attrition Rush','先 Sticky','Debuff 後靠近','Armor Taunt','Jump Heavy','Sticky 後 Rush','吸收 Projectile 得 Meter','mid',['Sticky','Projectile','Armor'],['爆發較低'],cpu(300,.58,.42,.66,.1,.05,.5,.68)),
 special1:move('sauce-sticky','蘸醬討飯',24,'projectile',17,4,20,7,'Projectile',390,{projectileSpeed:9,projectileLife:54,status:'sticky',statusDuration:60,moveSpeedMod:-.1}),
 special2:move('sauce-shake','濕狗甩水',25,'projectile',15,[1,1,1],24,[3,3,3],'Projectile',300,{projectileSpeed:8,projectileLife:44,rehitWindow:7}),
 functionMove:move('sauce-abs','腹肌亮相',26,'armor',8,1,18,0,'Mid',0,{armor:{kind:'Strike',hits:1,from:9,to:20},meterGainOnComplete:12}),
 ultimate:ult('sauce-ult','胡渣男！',28,'SAUCE_RAMPAGE_RUNTIME',30,15,30,{hardKnockdown:true})
},
{
 id:'scared',name:'驚嚇小貓',shortName:'驚嚇小貓',ratings:{hp:2,attack:3,speed:5,range:3,control:4},archetype:'Evasive Survival',cardTexture:card(11,'scared-cat'),sheetProfile:poses('scared'),movement:movement(5.2,4.6,10.4,10.8,5.4,-13.8),damageTakenScalar:1.08,palette:{primary:0xf4f4f4,accent:0x74c8ff},
 designProfile:design('Evasive Survival','高速試探與尖叫','壓力偏弱','後撤、炸毛、紙箱、殘影','Crouching Heavy','Whiff 後殘影追擊','逃避 Projectile 得 Meter','dynamic',['速度','Evasion','Reaction'],['低耐久','Corner 風險'],cpu(300,.42,.9,.48,.04,.1,.1,.75)),
 special1:move('scared-scream','尖叫震波',24,'projectile',13,5,19,8,'Projectile',300,{hitstun:17,blockstun:11,projectileSpeed:10,projectileLife:42}),
 special2:move('scared-fur','瞬間炸毛',25,'burst',5,5,23,9,'Mid',125,{invulnerability:[{kind:'Strike',from:1,to:3}],pushbackX:75}),
 special3:move('scared-nine','九命殘影',27,'dashStrike',7,4,20,10,'Mid',210,{invulnerability:[{kind:'Projectile',from:4,to:9}],status:'afterimage'}),
 functionMove:move('scared-box','紙箱避難',26,'hide',6,24,12,0,'Mid',0,{invulnerability:[{kind:'Projectile',from:7,to:22}],status:'box',statusDuration:24,cooldown:90}),
 ultimate:ult('scared-ult','嗷嗷嗷嗷嗷！！',28,'HUSKY_RUNTIME',30,15,30,{recovery:34})
},
{
 id:'ok',name:'OK喵老大',shortName:'OK喵老大',ratings:{hp:4,attack:4,speed:3,range:3,control:5},archetype:'Confidence Leader',cardTexture:card(12,'ok-boss'),sheetProfile:poses('ok'),movement:movement(4.2,3.5,9,8.2,4.4,-12.9),damageTakenScalar:.97,palette:{primary:0xe7e0d5,accent:0x9c55ff},
 designProfile:design('Confidence Leader','中距離壓迫','OK衝刺＋高 Blockstun 指令','Fear Counter Field','Crouching Heavy','Heavy Whiff 用衝刺','Fear 成功 +10 Meme','mid',['Command Pressure','Fear','Judgement'],['Fear 不打 Projectile/Throw'],cpu(270,.68,.38,.32,.14,.08,.12,.82)),
 special1:move('ok-rush','OK衝刺',24,'dashStrike',11,5,18,11,'Mid',190,{hitstun:18,blockstun:9,pushbackX:60,status:'ok'}),
 special2:move('ok-order','老大指令',25,'projectile',18,5,21,7,'Projectile',300,{hitstun:14,blockstun:16,projectileSpeed:9,projectileLife:45}),
 functionMove:move('ok-fear','眼神震懾',26,'fear',8,9,18,0,'Mid',260,{cooldown:150,status:'fear',statusDuration:9,meterGainOnComplete:10}),
 ultimate:ult('ok-ult','大哥你是了解我的',28,'OK_CAPTURE_RUNTIME',34,18,32)
}
];

export const FIGHTER_BY_ID=Object.fromEntries(FIGHTERS.map(f=>[f.id,f])) as Record<string,FighterConfig>;
