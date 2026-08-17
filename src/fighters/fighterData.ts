import type { AttackSpec } from '../combat/AttackSpec';
import type { FighterConfig } from './FighterConfig';

/**
 * The roster, ported from the upgraded build's twelve fighters.
 *
 * **What came across unchanged:** every timing. Startup, active, recovery,
 * hitstun, blockstun, the armour and invulnerability windows and the multi-hit
 * damage lists with their rehit gaps are the numbers that build was tuned to,
 * because both sides now count frames and there is nothing to convert.
 *
 * **What had to be re-authored:** knockback. The two engines disagree about what
 * a push *is* — the upgraded build applies a per-frame displacement it calls
 * `pushbackX`, while this simulation sets a velocity in pixels per second and
 * lets friction and gravity take it from there. There is no conversion between
 * them, only a judgement, so knockback is written in this simulation's units and
 * scaled to preserve the *relative* weight the upgraded data expressed: the
 * moves it pushed hardest are still the ones that push hardest. Meter values are
 * likewise this simulation's, which already had an economy tuned to a 100-point
 * bar.
 *
 * The four trunk-only fighters — 崩潰喵喵貓, 哭哭預警貓, 尷尬微笑貓, 震驚口水貓 —
 * are gone. They have no pose art and no ultimate in the delivered pipeline, and
 * the twelve below were chosen over them deliberately.
 */

type Optional = 'energyOnHit' | 'energyOnReceive' | 'chipRatio';

/** Every special shares its economy, so only the interesting fields are written. */
const special = (
  spec: Omit<AttackSpec, Optional> & Partial<Pick<AttackSpec, Optional>>,
): AttackSpec => ({ chipRatio: 0.1, energyOnHit: 10, energyOnReceive: 7, ...spec });

/**
 * Ultimates cost the whole bar, so they grant none — the meter is the cooldown.
 *
 * They are also invulnerable for the whole of their startup, which is not how
 * they were ported and is a deliberate change. An ultimate now begins a timeline
 * that runs for a hundred ticks and more; without this, any light attack thrown
 * during the startup deletes the entire thing — a full meter and every beat that
 * would have followed — for four frames of poke. That is not a punish, it is a
 * coin flip on whether the most expensive move in the game happens at all.
 *
 * The window ends when the startup does, so the recovery is still fully
 * punishable. Firing one into a guarded opponent remains a bad idea.
 */
const ultimate = (spec: Omit<AttackSpec, Optional>): AttackSpec => ({
  chipRatio: 0.15,
  energyOnHit: 0,
  energyOnReceive: 10,
  ...spec,
  invulnerable: spec.invulnerable ?? [{ against: 'all', from: 1, to: spec.startup }],
});

/** A utility move that never touches anyone: no damage, no reach, no chip. */
type Contact =
  | 'damage' | 'reach' | 'hitstun' | 'blockstun' | 'knockbackX' | 'knockbackY' | Optional;

const utility = (spec: Omit<AttackSpec, Contact>): AttackSpec => ({
  damage: 0,
  reach: 0,
  hitstun: 0,
  blockstun: 0,
  knockbackX: 0,
  knockbackY: 0,
  chipRatio: 0,
  energyOnHit: 0,
  energyOnReceive: 0,
  ...spec,
});

/** The anti-air half the roster carries, differing only in its numbers. */
const antiAir = (
  id: string,
  name: string,
  startup: number,
  active: number,
  recovery: number,
  damage: number,
  reach: number,
  invulnerableUntil: number,
): AttackSpec =>
  special({
    id, name, kind: 'antiAir',
    startup, active, recovery, damage,
    hitstun: 20, blockstun: 12,
    knockbackX: 210, knockbackY: -430,
    reach,
    cooldown: 78,
    invulnerable: [{ against: 'airAttack', from: 1, to: invulnerableUntil }],
  });

export const FIGHTERS: FighterConfig[] = [
  {
    id: 'alien', number: '01', name: 'Alien Meow／訊號壞掉喵', shortName: 'Alien Meow',
    archetype: '中距離牽制型', tagline: '不想交流，只想發射。',
    hpStat: 2, attackStat: 4, speedStat: 3, rangeStat: 5, controlStat: 4,
    cardTexture: 'card-01-alien', damageTakenScalar: 1.08,
    palette: { primary: 0x98ff00, secondary: 0x7cff00, accent: 0x3cffb0 },
    specials: {
      quarterForward: special({
        id: 'alien-beam', name: '斷訊掃描波', kind: 'beam',
        startup: 14, active: 6, recovery: 20, damage: 10,
        hitstun: 20, blockstun: 13, knockbackX: 300, knockbackY: -70,
        reach: 520, cooldown: 96,
      }),
      quarterBack: special({
        id: 'alien-cola', name: '宇宙可樂潑灑', kind: 'zone',
        startup: 18, active: 5, recovery: 23, damage: 8,
        hitstun: 18, blockstun: 11, knockbackX: 130, knockbackY: -200,
        reach: 310, cooldown: 108, telegraph: 24,
        hitStatus: { kind: 'slow', ticks: 48 },
      }),
      functionMove: antiAir('alien-antenna', '天線升頻', 7, 4, 24, 8, 115, 5),
    },
    ultimate: ultimate({
      id: 'alien-ult', name: '逼逼逼動感光波', kind: 'ultimate-alien',
      startup: 32, active: 18, recovery: 42, damage: 30,
      hitstun: 46, blockstun: 18, knockbackX: 550, knockbackY: -250, reach: 1000,
    }),
  },
  {
    id: 'doge', number: '02', name: 'Doge', shortName: 'Doge',
    archetype: '全能爆發型', tagline: '你是說克林嗎？',
    hpStat: 4, attackStat: 4, speedStat: 3, rangeStat: 3, controlStat: 3,
    cardTexture: 'card-02-doge', damageTakenScalar: 0.98,
    palette: { primary: 0xe8b04d, secondary: 0xffd98a, accent: 0xffe889 },
    specials: {
      quarterForward: special({
        id: 'doge-sideeye', name: '側眼施壓', kind: 'counter',
        startup: 3, active: 7, recovery: 18, damage: 9,
        hitstun: 22, blockstun: 12, knockbackX: 260, knockbackY: -90,
        reach: 105, cooldown: 84,
        // The stance is the move: three frames of startup, armoured throughout,
        // so it trades with anything that is not a throw.
        armor: { against: 'strike', hits: 1, from: 1, to: 10 },
      }),
      quarterBack: special({
        id: 'doge-bread', name: '麵包化衝撞', kind: 'dashStrike',
        startup: 16, active: 6, recovery: 22, damage: 12,
        hitstun: 20, blockstun: 12, knockbackX: 400, knockbackY: -120,
        reach: 190, cooldown: 102,
        armor: { against: 'strike', hits: 1, from: 6, to: 15 },
      }),
      functionMove: utility({
        id: 'doge-pet', name: '摸頭蓄怒', kind: 'meterCharge',
        startup: 12, active: 24, recovery: 12, cooldown: 180, meterOnComplete: 18,
      }),
    },
    ultimate: ultimate({
      id: 'doge-ult', name: '超級賽狗', kind: 'ultimate-sonic',
      startup: 26, active: 14, recovery: 40, damage: 29,
      hitstun: 44, blockstun: 18, knockbackX: 520, knockbackY: -210, reach: 540,
      // The transformation itself is on the timeline, at the tick the change
      // lands — see ultimateTimelines. It used to be `selfStatus`, which fires on
      // the move *completing*, and an ultimate no longer completes: control comes
      // back part-way through while the rest of the timeline plays out.
    }),
  },
  {
    id: 'ya', number: '03', name: 'YA鼠', shortName: 'YA鼠',
    archetype: '迴避反擊型', tagline: '等、等一下……不要拍啦！',
    hpStat: 2, attackStat: 2, speedStat: 4, rangeStat: 3, controlStat: 5,
    cardTexture: 'card-03-ya', damageTakenScalar: 1.07,
    palette: { primary: 0xf2a980, secondary: 0xffd0b0, accent: 0x8be0ff },
    specials: {
      quarterForward: special({
        id: 'ya-hi', name: '尷尬打招呼', kind: 'projectile',
        startup: 10, active: 4, recovery: 17, damage: 6,
        hitstun: 18, blockstun: 15, knockbackX: 240, knockbackY: -50,
        reach: 210, cooldown: 72, projectileSpeed: 480, lifetime: 34,
      }),
      quarterBack: special({
        id: 'ya-retreat', name: '倉皇後撤', kind: 'dashStrike',
        startup: 6, active: 3, recovery: 16, damage: 7,
        hitstun: 17, blockstun: 10, knockbackX: 250, knockbackY: -60,
        reach: 130, cooldown: 66,
      }),
      functionMove: utility({
        id: 'ya-glasses', name: '眼鏡抬頭', kind: 'parry',
        startup: 2, active: 6, recovery: 18, cooldown: 96,
        // Two frames to commit, six to be right about it.
        invulnerable: [{ against: 'all', from: 3, to: 8 }],
        meterOnComplete: 8,
      }),
    },
    ultimate: ultimate({
      id: 'ya-ult', name: '哈ㄗ咖西', kind: 'ultimate-social',
      startup: 30, active: 16, recovery: 42, damage: 28,
      hitstun: 48, blockstun: 20, knockbackX: 320, knockbackY: -170, reach: 900,
    }),
  },
  {
    id: 'tempura', number: '04', name: 'oh fucking 天婦羅尬哩涼', shortName: '天婦羅企鵝',
    archetype: '召喚壓制型', tagline: 'oh fucking 天婦羅尬哩涼！',
    hpStat: 3, attackStat: 4, speedStat: 2, rangeStat: 4, controlStat: 3,
    cardTexture: 'card-04-tempura', damageTakenScalar: 1,
    palette: { primary: 0x111a29, secondary: 0x2b3d55, accent: 0xff5b3a },
    specials: {
      quarterForward: special({
        id: 'tempura-penguins', name: '企鵝縱隊', kind: 'summon',
        startup: 20, active: 3, recovery: 24, damage: 12,
        hits: [4, 4, 4], rehitTicks: 14,
        hitstun: 16, blockstun: 10, knockbackX: 200, knockbackY: -40,
        reach: 520, cooldown: 114, projectileSpeed: 420, lifetime: 90,
        // Three of them, in a column. Blocking the first still leaves two coming.
        projectileCount: 3,
      }),
      quarterBack: special({
        id: 'tempura-paper', name: '紙片亂飛', kind: 'projectile',
        startup: 15, active: 3, recovery: 23, damage: 9,
        hits: [3, 3, 3], rehitTicks: 8,
        hitstun: 15, blockstun: 10, knockbackX: 180, knockbackY: -40,
        reach: 460, cooldown: 96, projectileSpeed: 600, lifetime: 60,
        projectileCount: 5,
      }),
      functionMove: utility({
        id: 'tempura-paperread', name: '讀報裝忙', kind: 'armor',
        startup: 4, active: 1, recovery: 18, cooldown: 108,
        armor: { against: 'projectile', hits: 1, from: 5, to: 14 },
      }),
    },
    ultimate: ultimate({
      id: 'tempura-ult', name: 'oh fucking 天婦羅尬哩涼！', kind: 'ultimate-freeze',
      startup: 30, active: 16, recovery: 42, damage: 30,
      hitstun: 46, blockstun: 18, knockbackX: 520, knockbackY: -220, reach: 760,
    }),
  },
  {
    id: 'goblin', number: '05', name: '哥布林也想談戀愛', shortName: '哥布林',
    archetype: '貼身指令投型', tagline: '犧牲十年壽命，變帥吧！',
    hpStat: 4, attackStat: 4, speedStat: 2, rangeStat: 2, controlStat: 4,
    cardTexture: 'card-05-goblin', damageTakenScalar: 0.98,
    palette: { primary: 0x77ba55, secondary: 0x9fd47f, accent: 0xff6b9e },
    specials: {
      quarterForward: special({
        id: 'goblin-choke', name: '鎖喉告白', kind: 'commandThrow',
        startup: 7, active: 2, recovery: 30, damage: 16,
        hitstun: 26, blockstun: 1, knockbackX: 200, knockbackY: -60,
        reach: 90, cooldown: 120,
        unblockable: true, hardKnockdown: true,
      }),
      quarterBack: special({
        id: 'goblin-heart', name: '怦然心動', kind: 'burst',
        startup: 15, active: 5, recovery: 20, damage: 6,
        hitstun: 30, blockstun: 12, knockbackX: 150, knockbackY: 0,
        reach: 145, cooldown: 96,
      }),
      functionMove: utility({
        id: 'goblin-bangs', name: '瀏海降臨', kind: 'install',
        startup: 12, active: 1, recovery: 12, cooldown: 180, meterOnComplete: 14,
        selfStatus: { kind: 'install', ticks: 180 },
      }),
    },
    ultimate: ultimate({
      id: 'goblin-ult', name: '長老您保重', kind: 'ultimate-ok',
      startup: 32, active: 12, recovery: 45, damage: 34,
      hitstun: 50, blockstun: 20, knockbackX: 500, knockbackY: -280, reach: 520,
    }),
  },
  {
    id: 'salad', number: '06', name: '沙拉貓貓', shortName: '沙拉貓貓',
    archetype: '坦克牽制型', tagline: '菜就多練啊！',
    hpStat: 5, attackStat: 4, speedStat: 1, rangeStat: 4, controlStat: 3,
    cardTexture: 'card-06-salad', damageTakenScalar: 0.92,
    palette: { primary: 0xf5f2e7, secondary: 0xa5d46a, accent: 0x7bd34f },
    specials: {
      quarterForward: special({
        id: 'salad-no', name: '我不想吃這個', kind: 'salad',
        startup: 19, active: 4, recovery: 22, damage: 9,
        hitstun: 20, blockstun: 12, knockbackX: 360, knockbackY: -130,
        reach: 440, cooldown: 108, projectileSpeed: 480, lifetime: 65,
      }),
      quarterBack: special({
        id: 'salad-away', name: '你拿遠一點', kind: 'strike',
        startup: 11, active: 4, recovery: 22, damage: 8,
        hitstun: 18, blockstun: 11, knockbackX: 460, knockbackY: -80,
        reach: 185, cooldown: 90,
      }),
      functionMove: antiAir('salad-aa', '盤緣上撥', 7, 4, 25, 8, 130, 5),
    },
    ultimate: ultimate({
      id: 'salad-ult', name: '菜就多練', kind: 'ultimate-salad',
      startup: 31, active: 16, recovery: 42, damage: 31,
      hitstun: 47, blockstun: 18, knockbackX: 250, knockbackY: -360,
      reach: 260, telegraph: 30,
    }),
  },
  {
    id: 'wizard', number: '07', name: '魔法胖橘貓', shortName: '魔法胖橘貓',
    archetype: '設置控場型', tagline: '偉大的喵蘇魯呀——出來吃飯啦！',
    hpStat: 4, attackStat: 3, speedStat: 2, rangeStat: 5, controlStat: 5,
    cardTexture: 'card-07-wizard', damageTakenScalar: 0.98,
    palette: { primary: 0xd78430, secondary: 0xaa4600, accent: 0xb158ff },
    specials: {
      quarterForward: special({
        id: 'wizard-circle', name: 'JPEG魔法陣', kind: 'zone',
        startup: 18, active: 4, recovery: 24, damage: 9,
        hitstun: 19, blockstun: 12, knockbackX: 130, knockbackY: -220,
        reach: 330, cooldown: 120, telegraph: 24,
      }),
      quarterBack: special({
        id: 'wizard-hat', name: '帽簷遮天', kind: 'dashStrike',
        startup: 18, active: 4, recovery: 24, damage: 10,
        hitstun: 20, blockstun: 12, knockbackX: 320, knockbackY: -150,
        reach: 165, cooldown: 96,
      }),
      functionMove: antiAir('wizard-staff', '木杖點天', 8, 5, 22, 8, 130, 4),
    },
    ultimate: ultimate({
      id: 'wizard-ult', name: '喵蘇魯的召喚！', kind: 'ultimate-magic',
      startup: 31, active: 18, recovery: 42, damage: 30,
      hitstun: 46, blockstun: 18, knockbackX: 420, knockbackY: -280, reach: 1000,
    }),
  },
  {
    id: 'blade', number: '08', name: '我的刀盾', shortName: '我的刀盾',
    archetype: '裝甲防禦型', tagline: '盾？不要了！幫我撐十秒！',
    hpStat: 5, attackStat: 3, speedStat: 2, rangeStat: 2, controlStat: 4,
    cardTexture: 'card-08-blade-shield', damageTakenScalar: 0.93,
    palette: { primary: 0xa95d23, secondary: 0xc98748, accent: 0xe1d094 },
    specials: {
      quarterForward: special({
        id: 'blade-grind', name: '鈍刀亂磨', kind: 'multiStrike',
        startup: 10, active: 10, recovery: 22, damage: 10,
        hits: [3, 3, 4], rehitTicks: 4,
        hitstun: 14, blockstun: 9, knockbackX: 180, knockbackY: -30,
        reach: 120, cooldown: 84,
      }),
      quarterBack: special({
        id: 'blade-rush', name: '龜殼舉盾衝', kind: 'dashStrike',
        startup: 14, active: 5, recovery: 22, damage: 11,
        hitstun: 20, blockstun: 12, knockbackX: 380, knockbackY: -110,
        reach: 190, cooldown: 102,
        armor: { against: 'strike', hits: 2, from: 5, to: 18 },
      }),
      functionMove: antiAir('blade-aa', '盾牌抬天', 6, 5, 20, 7, 125, 6),
    },
    ultimate: ultimate({
      id: 'blade-ult', name: '汪爆氣流斬', kind: 'ultimate-sonic',
      startup: 30, active: 14, recovery: 40, damage: 31,
      hitstun: 46, blockstun: 18, knockbackX: 520, knockbackY: -210, reach: 540,
      armor: { against: 'strike', hits: 2, from: 1, to: 52 },
    }),
  },
  {
    id: 'pink', number: '09', name: '粉紅星星', shortName: '粉紅星星',
    archetype: '尷尬爆發型', tagline: '不！我怪人的真面目要被看光光了！',
    hpStat: 3, attackStat: 4, speedStat: 3, rangeStat: 3, controlStat: 3,
    cardTexture: 'card-09-pink-star', damageTakenScalar: 1,
    palette: { primary: 0xff668d, secondary: 0xffb6c1, accent: 0x5dbeff },
    specials: {
      quarterForward: special({
        id: 'pink-scream', name: '尖叫嘴震', kind: 'sonic',
        startup: 12, active: 6, recovery: 20, damage: 8,
        hitstun: 18, blockstun: 12, knockbackX: 285, knockbackY: -70,
        reach: 260, cooldown: 84, projectileSpeed: 600, lifetime: 38,
      }),
      quarterBack: special({
        id: 'pink-real', name: '突然寫實臉', kind: 'burst',
        startup: 20, active: 5, recovery: 28, damage: 12,
        hitstun: 21, blockstun: 11, knockbackX: 420, knockbackY: -160,
        reach: 155, cooldown: 108,
      }),
      functionMove: antiAir('pink-aa', '星尖上頂', 6, 5, 25, 8, 125, 4),
    },
    ultimate: ultimate({
      id: 'pink-ult', name: '派甜心假面...露出', kind: 'ultimate-water',
      startup: 30, active: 15, recovery: 42, damage: 30,
      hitstun: 46, blockstun: 18, knockbackX: 520, knockbackY: -190, reach: 900,
    }),
  },
  {
    id: 'sauce', number: '10', name: '蘸醬胡渣狗', shortName: '蘸醬胡渣狗',
    archetype: '消耗突進型', tagline: '這不是胡渣！',
    hpStat: 4, attackStat: 3, speedStat: 3, rangeStat: 4, controlStat: 4,
    cardTexture: 'card-10-sauce-dog', damageTakenScalar: 0.98,
    palette: { primary: 0xe9cf99, secondary: 0xc9a06a, accent: 0x9f5f34 },
    specials: {
      quarterForward: special({
        id: 'sauce-sticky', name: '蘸醬討飯', kind: 'water',
        startup: 17, active: 4, recovery: 20, damage: 7,
        hitstun: 19, blockstun: 12, knockbackX: 300, knockbackY: -60,
        reach: 390, cooldown: 96, projectileSpeed: 540, lifetime: 54,
        // Low damage, but it glues them down for a second — this fighter wins by
        // attrition and needs them slow to do it.
        hitStatus: { kind: 'slow', ticks: 60 },
      }),
      quarterBack: special({
        id: 'sauce-shake', name: '濕狗甩水', kind: 'projectile',
        startup: 15, active: 3, recovery: 24, damage: 9,
        hits: [3, 3, 3], rehitTicks: 7,
        hitstun: 15, blockstun: 10, knockbackX: 180, knockbackY: -40,
        reach: 300, cooldown: 90, projectileSpeed: 480, lifetime: 44,
      }),
      functionMove: utility({
        id: 'sauce-abs', name: '腹肌亮相', kind: 'armor',
        startup: 8, active: 1, recovery: 18, cooldown: 108,
        armor: { against: 'strike', hits: 1, from: 9, to: 20 },
        meterOnComplete: 12,
      }),
    },
    ultimate: ultimate({
      id: 'sauce-ult', name: '胡渣男！', kind: 'ultimate-ok',
      startup: 30, active: 15, recovery: 42, damage: 30,
      hitstun: 46, blockstun: 18, knockbackX: 500, knockbackY: -280,
      reach: 520, hardKnockdown: true,
    }),
  },
  {
    id: 'scared', number: '11', name: '驚嚇小貓', shortName: '驚嚇小貓',
    archetype: '迴避生存型', tagline: '那……那不是夢，那是真狗！',
    hpStat: 2, attackStat: 3, speedStat: 5, rangeStat: 3, controlStat: 4,
    cardTexture: 'card-11-scared-cat', damageTakenScalar: 1.08,
    palette: { primary: 0xf4f4f4, secondary: 0xd9d9d9, accent: 0x74c8ff },
    specials: {
      quarterForward: special({
        id: 'scared-scream', name: '尖叫震波', kind: 'sonic',
        startup: 13, active: 5, recovery: 19, damage: 8,
        hitstun: 17, blockstun: 11, knockbackX: 285, knockbackY: -70,
        reach: 300, cooldown: 78, projectileSpeed: 600, lifetime: 42,
      }),
      quarterBack: special({
        id: 'scared-fur', name: '瞬間炸毛', kind: 'burst',
        startup: 5, active: 5, recovery: 23, damage: 9,
        hitstun: 19, blockstun: 11, knockbackX: 400, knockbackY: -100,
        reach: 125, cooldown: 90,
        // Three frames of full invulnerability: the reversal the whole
        // escape-artist identity is built on.
        invulnerable: [{ against: 'all', from: 1, to: 3 }],
      }),
      dragonPunch: special({
        id: 'scared-nine', name: '九命殘影', kind: 'dashStrike',
        startup: 7, active: 4, recovery: 20, damage: 10,
        hitstun: 20, blockstun: 12, knockbackX: 340, knockbackY: -110,
        reach: 210, cooldown: 96,
        invulnerable: [{ against: 'projectile', from: 4, to: 9 }],
        afterimage: true,
      }),
      functionMove: utility({
        id: 'scared-box', name: '紙箱避難', kind: 'hide',
        startup: 6, active: 24, recovery: 12, cooldown: 90,
        invulnerable: [{ against: 'projectile', from: 7, to: 22 }],
      }),
    },
    ultimate: ultimate({
      id: 'scared-ult', name: '嗷嗷嗷嗷嗷！！', kind: 'ultimate-freeze',
      startup: 30, active: 15, recovery: 34, damage: 30,
      hitstun: 46, blockstun: 18, knockbackX: 520, knockbackY: -220, reach: 760,
    }),
  },
  {
    id: 'ok', number: '12', name: 'OK喵老大', shortName: 'OK喵老大',
    archetype: '指令壓迫型', tagline: '兄弟們！站著把錢給我掙了！',
    hpStat: 4, attackStat: 4, speedStat: 3, rangeStat: 3, controlStat: 5,
    cardTexture: 'card-12-ok-boss', damageTakenScalar: 0.97,
    palette: { primary: 0xe7e0d5, secondary: 0xffd966, accent: 0x9c55ff },
    specials: {
      quarterForward: special({
        id: 'ok-rush', name: 'OK衝刺', kind: 'dashStrike',
        startup: 11, active: 5, recovery: 18, damage: 11,
        hitstun: 18, blockstun: 9, knockbackX: 390, knockbackY: -110,
        reach: 190, cooldown: 90,
      }),
      quarterBack: special({
        id: 'ok-order', name: '老大指令', kind: 'projectile',
        // Unusually high blockstun for its damage: the move exists to make you
        // hold still, not to hurt you.
        startup: 18, active: 5, recovery: 21, damage: 7,
        hitstun: 14, blockstun: 13, knockbackX: 240, knockbackY: -50,
        reach: 300, cooldown: 96, projectileSpeed: 540, lifetime: 45,
      }),
      functionMove: special({
        id: 'ok-fear', name: 'OK 威壓', kind: 'aura',
        startup: 13, active: 9, recovery: 22, damage: 6,
        hitstun: 30, blockstun: 9, knockbackX: 90, knockbackY: 0,
        reach: 260, cooldown: 108, stunLockout: 168,
      }),
    },
    ultimate: ultimate({
      id: 'ok-ult', name: '大哥你是了解我的', kind: 'ultimate-ok',
      startup: 30, active: 16, recovery: 42, damage: 31,
      hitstun: 48, blockstun: 20, knockbackX: 500, knockbackY: -280, reach: 520,
    }),
  },
];

/**
 * Texture key for the small card used in menus.
 *
 * The card art is only ever displayed at 238x298 or less, so the menus load a
 * downscaled WebP instead of the multi-megabyte source PNG.
 */
export const thumbTextureKey = (fighter: FighterConfig): string => `thumb-${fighter.number}`;

export const getFighterConfig = (id: string): FighterConfig => {
  const fighter = FIGHTERS.find((entry) => entry.id === id);
  if (!fighter) throw new Error(`Unknown fighter id: ${id}`);
  return fighter;
};
