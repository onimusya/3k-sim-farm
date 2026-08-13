#!/usr/bin/env node
import { resolve } from 'node:path';
import * as H from './lib/harness.mjs';

const args=H.parseArgs();
const PORT=Number(args.port??5277);
const ROOT=resolve(args.root??process.cwd());
const server=await H.ensureServer({port:PORT,root:ROOT});
const browser=await H.launchBrowser();
const page=await H.newPage(browser,{w:1280,h:720});
const report={ok:true,checks:[]};
const check=(name,pass,detail='')=>{report.checks.push({name,pass:!!pass,detail});if(!pass)report.ok=false;};
try{
  await page.addInitScript(()=>localStorage.clear());
  await H.open(page,`http://127.0.0.1:${PORT}/?capture=1&lockstep=1`);
  await page.evaluate(()=>{document.querySelector('#boot-card')?.setAttribute('hidden','');});
  const state=()=>page.evaluate(()=>window.__GAME_STATE__());
  const stage=async(n)=>{await page.evaluate(step=>window.__ENGINE__.ctx.get('farm').debugStage(step),n);await H.pump(page,4);return state();};
  let s=await state();check('starts at water task',s.step===1&&/water/i.test(s.task),JSON.stringify(s));
  for(let n=1;n<=7;n++){s=await stage(n);check(`stage ${n} finite`,s.step===n&&Array.isArray(s.player)&&s.player.every(Number.isFinite),JSON.stringify(s));}
  await stage(2);
  await page.evaluate(()=>{const e=window.__ENGINE__;for(let i=0;i<10;i++)e.events.emit('interaction:attempt',{id:'water1'});});
  s=await state();check('E-spam idempotent',(s.progress?.watered??0)<=1,JSON.stringify(s.progress));
  await page.evaluate(()=>{const p=window.__ENGINE__.ctx.get('player');p.position.set(99,0,99);window.__ENGINE__.input.takeControl().inject('KeyR',true);});
  await H.pump(page,3);s=await state();check('recovery returns in bounds',Math.abs(s.player[0])<30&&Math.abs(s.player[2])<30,JSON.stringify(s.player));
  await page.evaluate(()=>window.__ENGINE__.ctx.get('farm').debugStage('complete'));
  await H.pump(page,4);
  await page.evaluate(()=>window.__ENGINE__.events.emit('day:restart',{source:'test'}));
  await H.pump(page,4);s=await state();check('begin again resets full day',s.step===1&&!s.dayComplete&&s.progress.watered===0&&s.progress.harvested===0&&s.phase==='dawn',JSON.stringify(s));
  check('assert hooks present',await page.evaluate(()=>['task-current','task-progress','interaction-prompt','day-phase','day-complete'].every(id=>document.querySelector(`[data-testid="${id}"]`))));
  check('no console errors',H.errorsOnly(page.__logs).length===0,H.errorsOnly(page.__logs)[0]??'');
}catch(e){check('fatal',false,e.stack??e.message);}finally{await browser.close();server?.kill();}
H.finish(report);
