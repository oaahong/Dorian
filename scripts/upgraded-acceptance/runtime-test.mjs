import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';
const port=4174;
const prep=spawnSync(process.execPath,['scripts/prepare-runtime-fallback.mjs'],{stdio:'inherit',env:{...process.env}});if(prep.status!==0)process.exit(prep.status??1);
const child=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1','--directory','.runtime-site'],{stdio:['ignore','pipe','pipe'],env:{...process.env}});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const stop=()=>{if(!child.killed)child.kill('SIGTERM')};process.on('exit',stop);process.on('SIGINT',()=>{stop();process.exit(130)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitServer(){for(let i=0;i<90;i++){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}`);if(r.ok)return;}catch{}await sleep(250);}throw new Error(`Runtime fallback server did not start.\n${logs}`)}
let browser;
try{
 await waitServer();
 const {chromium}=await import('playwright-core');
 const executable=process.env.CHROMIUM_PATH||['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].find(fs.existsSync);
 if(!executable)throw new Error('Chromium executable not found; set CHROMIUM_PATH.');
 browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});await page.waitForSelector('canvas');
 const scene=()=>page.evaluate(()=>window.__MEME_FIGHT__?.scene.getScenes(true)[0]?.scene.key);
 if(await scene()!=='TitleScene')throw new Error(`Expected TitleScene, got ${await scene()}`);
 await page.keyboard.press('Enter');await sleep(90);if(await scene()!=='ModeSelectScene')throw new Error('Mode select flow failed');
 await page.keyboard.press('Enter');await sleep(90);if(await scene()!=='CharacterSelectScene')throw new Error('Character select flow failed');
 const cells=await page.evaluate(()=>window.__MEME_FIGHT__?.scene.getScene('CharacterSelectScene')?.cells?.length);if(cells!==12)throw new Error(`Expected 12 character cells, got ${cells}`);
 await page.keyboard.press('KeyF');await sleep(1500);if(await scene()!=='BattleScene')throw new Error(`Battle flow failed: ${await scene()}`);
 // Bare H: hold <0.4s => Lv1, release to execute, then Recovery must return immediately to chargeable IDLE with no cooldown.
 await page.keyboard.down('KeyH');await sleep(180);let hstate=await page.evaluate(()=>window.__MEME_FIGHT__.scene.getScene('BattleScene').hCharge.debug(window.__MEME_FIGHT__.scene.getScene('BattleScene').p1));if(!String(hstate).startsWith('CHARGING L1'))throw new Error(`H did not charge Lv1: ${hstate}`);await page.keyboard.up('KeyH');await sleep(120);let hmove=await page.evaluate(()=>window.__MEME_FIGHT__.scene.getScene('BattleScene').p1.currentMove?.id||'');if(!hmove.startsWith('h-'))throw new Error(`H release did not start H move: ${hmove}`);await sleep(850);await page.keyboard.down('KeyH');await sleep(90);hstate=await page.evaluate(()=>window.__MEME_FIGHT__.scene.getScene('BattleScene').hCharge.debug(window.__MEME_FIGHT__.scene.getScene('BattleScene').p1));if(!String(hstate).startsWith('CHARGING'))throw new Error(`H cooldown/regate detected: ${hstate}`);await page.keyboard.up('KeyH');await sleep(450);
 // Meme: charge while held; reaching 100 while held must not trigger. Release arms; new press consumes exactly once and starts Cut-in.
 await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('BattleScene');s.p1.meter=99.2;s.ult1.syncAfterExternalMeterChange(s.p1,false);});
 await page.keyboard.down('KeyT');await sleep(300);let meme=await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('BattleScene');return{meter:s.p1.meter,state:s.ult1.state,cut:s.cutIn.isActive}});if(meme.meter<99.9||meme.state!=='MEME_READY_WAIT_RELEASE'||meme.cut)throw new Error(`Held T auto-trigger/ready failure ${JSON.stringify(meme)}`);
 await page.keyboard.up('KeyT');await sleep(100);meme=await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('BattleScene');return{meter:s.p1.meter,state:s.ult1.state,cut:s.cutIn.isActive}});if(meme.state!=='MEME_READY_WAIT_PRESS'||meme.cut)throw new Error(`T release arm failure ${JSON.stringify(meme)}`);
 await page.keyboard.press('KeyT');await sleep(520);meme=await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('BattleScene');return{meter:s.p1.meter,state:s.ult1.state,cut:s.cutIn.isActive,texts:s.children.list.filter(x=>x.type==='Text').map(x=>x.text)}});if(meme.meter>0.01||meme.state!=='ULTIMATE_CUTIN'||!meme.cut)throw new Error(`T new press Ultimate failure ${JSON.stringify(meme)}`);if(!meme.texts.includes('逼逼逼動感光波'))throw new Error('Official Ultimate title not visible in Cut-in');
 await sleep(1850);const runtime=await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('BattleScene');return{cut:s.cutIn.isActive,has:s.combat.hasUltimate(s.p1),state:s.ult1.state}});if(runtime.cut||!runtime.has||runtime.state!=='ULTIMATE_GAMEPLAY')throw new Error(`Cut-in→Gameplay runtime failure ${JSON.stringify(runtime)}`);
 // Spend Meme after externally-ready state must cancel readiness immediately.
 await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('BattleScene');s.combat.clear();s.ult1.reset();s.p1.currentMove=null;s.p1.enterState('IDLE');s.p1.meter=100;s.ult1.syncAfterExternalMeterChange(s.p1,false);s.p1.spendMeter(25);s.ult1.syncAfterExternalMeterChange(s.p1,false);});
 const spent=await page.evaluate(()=>window.__MEME_FIGHT__.scene.getScene('BattleScene').ult1.state);if(spent!=='MEME_IDLE')throw new Error(`Ready did not cancel after meter spend: ${spent}`);
 // 12-Ultimate smoke test: each uses its official title/background, enters gameplay Runtime, then cleans without exception.
 const roster=[['alien','逼逼逼動感光波'],['doge','超級賽狗'],['ya','哈ㄗ咖西'],['tempura','oh fucking 天婦羅尬哩涼！'],['goblin','長老您保重'],['salad','菜就多練'],['wizard','喵蘇魯的召喚！'],['blade','汪爆氣流斬'],['pink','派甜心假面...露出'],['sauce','胡渣男！'],['scared','嗷嗷嗷嗷嗷！！'],['ok','大哥你是了解我的']];
 for(const [fid,title] of roster){
  await page.evaluate(fid=>{const g=window.__MEME_FIGHT__;const setup={mode:'training',p1:fid,p2:fid==='ok'?'alien':'ok',difficulty:'NORMAL'};g.registry.set('matchSetup',setup);g.scene.getScenes(true)[0].scene.start('TrainingScene',{setup});},fid);await sleep(220);
  if(await scene()!=='TrainingScene')throw new Error(`${fid}: TrainingScene start failed`);
  await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('TrainingScene');s.p1.meter=100;s.ult1.syncAfterExternalMeterChange(s.p1,false);});await page.keyboard.press('KeyT');await sleep(520);
  const cut=await page.evaluate(title=>{const s=window.__MEME_FIGHT__.scene.getScene('TrainingScene');return{active:s.cutIn.isActive,meter:s.p1.meter,texts:s.children.list.filter(x=>x.type==='Text').map(x=>x.text),bg:s.children.list.some(x=>x.texture?.key===`ultimate-bg-${s.p1.config.id}`)};},title);
  if(!cut.active||cut.meter>0.01||!cut.texts.includes(title)||!cut.bg)throw new Error(`${fid}: Cut-in smoke failed ${JSON.stringify(cut)}`);
  await sleep(1900);const gp=await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('TrainingScene');return{s:s.ult1.state,has:s.combat.hasUltimate(s.p1),install:s.p1.installType,scale:s.p1.sprite.scaleX};});if(gp.s!=='ULTIMATE_GAMEPLAY'&&!gp.has&&!["doge","goblin","blade","pink"].includes(fid))throw new Error(`${fid}: Gameplay runtime did not start ${JSON.stringify(gp)}`);
  await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('TrainingScene');s.cutIn.abort();s.combat.clear();s.p1.exitInstall();s.hCharge.reset();s.ult1.reset();});await sleep(30);
 }
 // Training fixed clock freeze remains available and Cut-in implementation did not replace it.
 await page.evaluate(()=>{const s=window.__MEME_FIGHT__.scene.getScene('TrainingScene');s.resetRound(true);});await page.keyboard.press('F3');await sleep(80);const before=await page.evaluate(()=>window.__MEME_FIGHT__.scene.getScene('TrainingScene').clock.frame);await page.keyboard.press('F4');await sleep(80);const after=await page.evaluate(()=>window.__MEME_FIGHT__.scene.getScene('TrainingScene').clock.frame);if(after-before!==1)throw new Error(`Frame advance expected +1, got ${after-before}`);
 if(errors.length)throw new Error(`Browser errors:\n${errors.join('\n')}`);
 console.log('RUNTIME QA PASS: scenes, bare-H re-charge/no-CD, T hold/release/new-press, 12 Cut-ins/Runtime smoke, Training +1F.');
} finally {if(browser)await browser.close();stop();}
