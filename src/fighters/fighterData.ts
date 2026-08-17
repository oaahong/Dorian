import type { FighterConfig } from './FighterConfig';

export const FIGHTERS: FighterConfig[] = [
  {
    id: 'collapse', number: '01', name: '崩潰喵喵貓', shortName: '崩潰貓', archetype: '近戰爆發型',
    tagline: '不是在尖叫，就是在準備尖叫。', hpStat: 3, attackStat: 5, speedStat: 4, rangeStat: 2, controlStat: 2,
    cardTexture: 'card-01', palette: { primary: 0xff4040, secondary: 0xffe14d, accent: 0x00c8ff },
    special: { id:'collapse-special', name:'崩潰音波', kind:'sonic', startup:9, active:7, recovery:17, damage:12, hitstun:16, blockstun:7, knockbackX:285, knockbackY:-70, reach:300, cooldown:90, chipRatio:.10, energyOnHit:10, energyOnReceive:7, projectileSpeed:650, lifetime:51 },
    ultimate: { id:'collapse-ult', name:'JPEG震爆', kind:'ultimate-sonic', startup:31, active:13, recovery:39, damage:30, hitstun:39, blockstun:16, knockbackX:520, knockbackY:-210, reach:540, chipRatio:.15, energyOnHit:0, energyOnReceive:10 },
  },
  {
    id: 'cry', number: '02', name: '哭哭預警貓', shortName: '哭哭貓', archetype: '防守／反擊型',
    tagline: '不是玻璃心，只是心理水庫滿了。', hpStat: 2, attackStat: 2, speedStat: 4, rangeStat: 4, controlStat: 4,
    cardTexture: 'card-02', palette: { primary: 0x91d2ff, secondary: 0x7ee0ff, accent: 0xff9eb6 },
    special: { id:'cry-special', name:'哭哭水柱', kind:'water', startup:11, active:9, recovery:17, damage:10.5, hitstun:15, blockstun:8, knockbackX:340, knockbackY:-60, reach:410, cooldown:87, chipRatio:.10, energyOnHit:10, energyOnReceive:7, projectileSpeed:730, lifetime:54 },
    ultimate: { id:'cry-ult', name:'情緒海嘯', kind:'ultimate-water', startup:34, active:25, recovery:39, damage:29, hitstun:39, blockstun:16, knockbackX:520, knockbackY:-190, reach:900, chipRatio:.15, energyOnHit:0, energyOnReceive:10 },
  },
  {
    id: 'okboss', number: '03', name: 'OK老大貓', shortName: 'OK老大', archetype: '平衡萬用型',
    tagline: 'OK 就對了，老大說的。', hpStat: 4, attackStat: 4, speedStat: 3, rangeStat: 3, controlStat: 4,
    cardTexture: 'card-03', palette: { primary: 0xffd966, secondary: 0xffb383, accent: 0x8ee5ff },
    special: { id:'ok-special', name:'OK衝刺', kind:'dash', startup:9, active:10, recovery:18, damage:14, hitstun:20, blockstun:10, knockbackX:390, knockbackY:-110, reach:190, cooldown:96, chipRatio:.10, energyOnHit:10, energyOnReceive:7 },
    ultimate: { id:'ok-ult', name:'超級OK判定', kind:'ultimate-ok', startup:34, active:16, recovery:39, damage:30, hitstun:42, blockstun:17, knockbackX:500, knockbackY:-280, reach:520, chipRatio:.15, energyOnHit:0, energyOnReceive:10 },
  },
  {
    id: 'awkward', number: '04', name: '尷尬微笑貓', shortName: '尷尬貓', archetype: '控場心理戰型',
    tagline: '你以為你在看貓，其實你被牠盯上了。', hpStat: 4, attackStat: 3, speedStat: 2, rangeStat: 4, controlStat: 5,
    cardTexture: 'card-04', palette: { primary: 0xffb6c1, secondary: 0x8e8e8e, accent: 0x6a00ff },
    special: { id:'awkward-special', name:'尷尬僵直', kind:'aura', startup:13, active:9, recovery:18, damage:6, hitstun:30, blockstun:9, knockbackX:90, knockbackY:0, reach:260, cooldown:108, chipRatio:.10, energyOnHit:10, energyOnReceive:7, stunLockout:168 },
    ultimate: { id:'awkward-ult', name:'社死領域', kind:'ultimate-social', startup:31, active:29, recovery:39, damage:28, hitstun:48, blockstun:18, knockbackX:320, knockbackY:-170, reach:900, chipRatio:.15, energyOnHit:0, energyOnReceive:10 },
  },
  {
    id: 'salad', number: '05', name: '厭世沙拉貓', shortName: '沙拉貓', archetype: '坦克重擊型',
    tagline: '我不是在吃沙拉，我是勉強維持健康。', hpStat: 5, attackStat: 4, speedStat: 1, rangeStat: 3, controlStat: 2,
    cardTexture: 'card-05', palette: { primary: 0xa5d46a, secondary: 0x3e7d3a, accent: 0xdcc77a },
    special: { id:'salad-special', name:'沙拉掀桌', kind:'salad', startup:14, active:11, recovery:22, damage:14, hitstun:21, blockstun:11, knockbackX:360, knockbackY:-130, reach:350, cooldown:108, chipRatio:.10, energyOnHit:10, energyOnReceive:7, projectileSpeed:540, lifetime:66 },
    ultimate: { id:'salad-ult', name:'健康餐大爆扣', kind:'ultimate-salad', startup:39, active:14, recovery:42, damage:31, hitstun:47, blockstun:18, knockbackX:250, knockbackY:-360, reach:260, telegraph:30, chipRatio:.15, energyOnHit:0, energyOnReceive:10 },
  },
  {
    id: 'drool', number: '06', name: '震驚口水貓', shortName: '口水貓', archetype: '高速突進型',
    tagline: '看到什麼都嚇傻，口水卻很有戰術價值。', hpStat: 3, attackStat: 3, speedStat: 5, rangeStat: 2, controlStat: 3,
    cardTexture: 'card-06', palette: { primary: 0xd9d9d9, secondary: 0x8ec7ef, accent: 0xffffff },
    special: { id:'drool-special', name:'冰櫃滑步', kind:'slide', startup:10, active:11, recovery:16, damage:11.5, hitstun:17, blockstun:8, knockbackX:300, knockbackY:-70, reach:215, cooldown:81, chipRatio:.10, energyOnHit:10, energyOnReceive:7 },
    ultimate: { id:'drool-ult', name:'冷凍驚嚇', kind:'ultimate-freeze', startup:32, active:19, recovery:37, damage:29, hitstun:46, blockstun:17, knockbackX:520, knockbackY:-220, reach:760, chipRatio:.15, energyOnHit:0, energyOnReceive:10 },
  },
  {
    id: 'alien', number: '07', name: '外星電波貓', shortName: '外星貓', archetype: '遠距離壓制型',
    tagline: '不想交流，只想發射。', hpStat: 2, attackStat: 4, speedStat: 3, rangeStat: 5, controlStat: 4,
    cardTexture: 'card-07', palette: { primary: 0x39ff14, secondary: 0x7cff00, accent: 0xcfffc6 },
    special: { id:'alien-special', name:'電波光束', kind:'beam', startup:15, active:13, recovery:20, damage:13, hitstun:18, blockstun:10, knockbackX:300, knockbackY:-70, reach:620, cooldown:108, chipRatio:.10, energyOnHit:10, energyOnReceive:7 },
    ultimate: { id:'alien-ult', name:'地球人退散', kind:'ultimate-alien', startup:37, active:21, recovery:42, damage:30, hitstun:46, blockstun:18, knockbackX:550, knockbackY:-250, reach:1000, chipRatio:.15, energyOnHit:0, energyOnReceive:10 },
  },
  {
    id: 'wizard', number: '08', name: '魔法胖橘貓', shortName: '魔法胖橘', archetype: '法術設置型',
    tagline: '他不是在裝 B，他是真的覺得自己很強。', hpStat: 4, attackStat: 3, speedStat: 2, rangeStat: 5, controlStat: 5,
    cardTexture: 'card-08', palette: { primary: 0xaa4600, secondary: 0x9822b8, accent: 0x6a5acd },
    special: { id:'wizard-special', name:'JPEG魔法陣', kind:'zone', startup:11, active:10, recovery:23, damage:13, hitstun:19, blockstun:10, knockbackX:130, knockbackY:-220, reach:680, cooldown:120, telegraph:27, chipRatio:.10, energyOnHit:10, energyOnReceive:7 },
    ultimate: { id:'wizard-ult', name:'爆裂喵法會', kind:'ultimate-magic', startup:38, active:22, recovery:42, damage:30, hitstun:46, blockstun:18, knockbackX:420, knockbackY:-280, reach:1000, chipRatio:.15, energyOnHit:0, energyOnReceive:10 },
  },
];

/**
 * Texture key for the small card used in menus.
 *
 * The card art is only ever displayed at 238x298 or less, so the menus load a
 * downscaled WebP instead of the 3 MB source PNG. The full-resolution card is
 * fetched only when a match needs it, because pose extraction reads its pixels.
 */
export const thumbTextureKey = (fighter: FighterConfig): string => `thumb-${fighter.number}`;

export const getFighterConfig = (id: string): FighterConfig => {
  const fighter = FIGHTERS.find((entry) => entry.id === id);
  if (!fighter) throw new Error(`Unknown fighter id: ${id}`);
  return fighter;
};
