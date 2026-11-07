const { chromium } = require('playwright');
const BASE = require('path').resolve(__dirname, '..');
(async()=>{
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844}});const p=await ctx.newPage();
 const errs=[],ext=[];p.on('pageerror',e=>errs.push(e.message));p.on('request',r=>{if(!/^(file:|data:|blob:|about:)/.test(r.url()))ext.push(r.url())});
 await p.goto('file://'+BASE+'/prototype/brain_dojo_v6.html');
 const out={};
 const names=async()=>p.$$eval('.stack8:nth-of-type(1) .rows:first-of-type .row b, .rows .row b',e=>e.map(x=>x.textContent));
 for(const age of ['10','20','30','40']){
  if(age==='10'){await p.click('[data-act=pick-age][data-v="10"]');await p.click('[data-act=age-confirm]');}
  else{await p.click('[data-act=open-age]');await p.click('[data-act=set-age][data-v="'+age+'"]');}
  out['age'+age]={goal:await p.innerText('[data-act=open-goal]'),rows:await names()};
 }
 await p.screenshot({path:BASE+'/tests/shots/v2_home.png',fullPage:true});
 await p.click('[data-act=open-goal]');await p.screenshot({path:BASE+'/tests/shots/v2_goalsheet.png'});
 await p.click('[data-act=set-goal][data-v=memory]');
 out.afterMemory={goal:await p.innerText('[data-act=open-goal]'),rows:await names()};
 await p.click('[data-act=open-age]');await p.click('[data-act=set-age][data-v="10"]');
 out.ageChangeKeepsGoal=await p.innerText('[data-act=open-goal]');
 await p.reload();out.persist=await p.evaluate(()=>window.__dojo.save().goal);
 await p.click('[data-act=tab][data-v=settings]');out.settings=(await p.innerText('.list')).replace(/\n/g,' | ');
 await p.screenshot({path:BASE+'/tests/shots/v2_settings.png',fullPage:true});
 // overflow
 out.overflow={};for(const w of [320,390,1100]){await p.setViewportSize({width:w,height:800});for(const t of ['home','settings']){await p.click('[data-act=tab][data-v='+t+']');out.overflow[w+t]=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);}}
 // start-session with goal memory(ufov無し)・quick
 await p.setViewportSize({width:390,height:844});await p.click('[data-act=tab][data-v=home]');
 await p.click('[data-act=start-quick]');out.quickScreen=await p.evaluate(()=>({s:window.__dojo.ui().screen,q:window.__dojo.ui().session.queue.map(x=>x.g)}));await p.click('[data-act=intro-close]');
 // focus goal: ufov playable w/o opt
 await p.click('[data-act=open-goal]');await p.click('[data-act=set-goal][data-v=focus]');
 await p.click('[data-act=play][data-g=dual]');await p.click('[data-act=begin]');await p.waitForTimeout(6000);
 out.ufovPhase=await p.evaluate(()=>window.__dojo.peek()&&window.__dojo.peek().phase);
 out.dualInfo=await p.evaluate(()=>window.__dojo.ui().game.item);out.errs=errs;out.ext=ext;console.log(JSON.stringify(out,null,1));await b.close();})();
