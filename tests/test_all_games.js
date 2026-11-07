const { chromium } = require('playwright');
const fs = require('fs');
const BASE = require('path').resolve(__dirname, '..');
const URL = 'file://' + BASE + '/prototype/brain_dojo_v7.html';
const SHOT = BASE + '/tests/shots/';
fs.mkdirSync(SHOT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const problems = [];
const external = [];
const report = {};

async function newPage(browser, w = 390, h = 844) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'ja-JP' });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
  page.on('request', r => {
    const u = r.url();
    if (!/^(file:|data:|blob:|about:)/.test(u)) external.push(u);
  });
  await page.goto(URL);
  return page;
}
async function pickAge(page, age) {
  await page.click('[data-act=pick-age][data-v="' + age + '"]');
  await page.click('[data-act=age-confirm]');
}

// ページ内で1手だけ操作するボット(ピーク→クリックを同じ瞬間に行う)
const stepFn = (bad) => {
  const d = window.__dojo, ui = d.ui();
  if (ui.screen !== 'play') return { s: 'done' };
  const g = ui.game && ui.game.item.g, p = d.peek();
  if (!p) return { s: 'wait', g };
  const q = s => document.querySelector(s);
  switch (g) {
    case 'switch': { const w = p.want; q('#a' + (bad ? (w === 'L' ? 'R' : 'L') : w)).click(); return { s: 'act', g }; }
    case 'compare': { const w = p.want; q('[data-a=' + (bad ? (w === 'L' ? 'R' : 'L') : w) + ']').click(); return { s: 'act', g }; }
    case 'stroop': { const w = p.want; const o = ['red','blue','green','purple'].filter(x => x !== w)[0]; q('.ans[data-a=' + (bad ? o : w) + ']').click(); return { s: 'act', g }; }
    case 'schulte': { q('.cell[data-n="' + p.next + '"]').click(); return { s: 'act', g }; }
    case 'picmem': { if (!p.canAns) return { s: 'wait', g, p }; const yes = bad ? !p.old : p.old; q('[data-a=' + (yes ? 'yes' : 'no') + ']').click(); return { s: 'act', g }; }
    case 'gonogo': { if (p.active && p.go) { q('#tap').click(); return { s: 'act', g }; } return { s: 'wait', g, p }; }
    case 'oddone': { q('.cell[data-i="' + p.target + '"]').click(); return { s: 'act', g }; }
    case 'nback': { if (!p.canAns) return { s: 'wait', g, p }; const same = bad ? !p.match : p.match; q('[data-a=' + (same ? 'same' : 'diff') + ']').click(); return { s: 'act', g }; }
    case 'span': case 'spanrev': { if (!p.accepting) return { s: 'wait', g, p }; q('.padc[data-i="' + p.next + '"]').click(); return { s: 'act', g }; }
    case 'ufov': case 'dual': {
      if (p.phase !== 'answer') return { s: 'wait', g, p };
      q('.cbtn[data-c=' + p.center + ']').click();
      q('.rbtn[data-p="' + p.tpos + '"]').click();
      return { s: 'act', g };
    }
  }
  return { s: 'wait', g };
};

async function botLoop(page, bad, shotName) {
  const t0 = Date.now(); let shotPlay = false, shotStim = false, shotAns = false;
  while (true) {
    const pre = await page.evaluate(() => {
      const ui = window.__dojo.ui(); return { screen: ui.screen, g: ui.game && ui.game.item.g, p: window.__dojo.peek() };
    });
    if (pre.screen !== 'play') return;
    if (shotName) {
      if (pre.g !== 'ufov' && pre.p && !shotPlay) { shotPlay = true; await page.screenshot({ path: SHOT + shotName + '_play.png' }); }
      if (pre.g === 'ufov' && pre.p) {
        if (pre.p.phase === 'stim' && !shotStim) { shotStim = true; await page.screenshot({ path: SHOT + shotName + '_stim.png' }); }
        if (pre.p.phase === 'answer' && !shotAns) { shotAns = true; await page.screenshot({ path: SHOT + shotName + '_answer.png' }); }
      }
    }
    await page.evaluate(stepFn, bad);
    await sleep(20);
    if (Date.now() - t0 > 200000) throw new Error('bot timeout');
  }
}

async function playOne(browser, g, bad, shotName) {
  const page = await newPage(browser);
  await pickAge(page, '40');
  await page.click('[data-act=play][data-g="' + g + '"]');
  await page.click('[data-act=begin]');
  await botLoop(page, bad, shotName);
  const res = await page.evaluate(() => {
    const ui = window.__dojo.ui(); return { screen: ui.screen, r: ui.session.results[0], save: window.__dojo.save() };
  });
  if (shotName) await page.screenshot({ path: SHOT + shotName + '_result.png', fullPage: true });
  const text = await page.innerText('#app');
  await page.context().close();
  return { screen: res.screen, r: res.r, plays: res.save.plays[g], level: res.save.level[g], hasText: /正解した数/.test(text) };
}

(async () => {
  const browser = await chromium.launch();

  // ---- 1. 画面確認(年代選択・ホーム各年代) ----
  {
    const page = await newPage(browser);
    await page.screenshot({ path: SHOT + '01_select_empty.png', fullPage: true });
    const disabled = await page.$eval('[data-act=age-confirm]', b => b.disabled);
    await page.click('[data-act=pick-age][data-v="30"]');
    await page.screenshot({ path: SHOT + '02_select_30.png', fullPage: true });
    await page.click('[data-act=age-confirm]');
    const names = {};
    for (const age of ['10', '20', '30', '40']) {
      if (age !== '30') {
        await page.click('[data-act=open-age]');
        await page.click('[data-act=set-age][data-v="' + age + '"]');
      }
      names[age] = await page.$$eval('.rows:nth-of-type(1) .row b, section .stack8:nth-of-type(1) .row b', els => els.map(e => e.textContent));
      await page.screenshot({ path: SHOT + '03_home_' + age + '.png', fullPage: true });
    }
    report.selectDisabledAtStart = disabled;
    report.menuNames = names;
    // 年代メニューの行数(今日のメニュー=3, ほかのゲーム=4)
    report.rowCount = await page.$$eval('.row', e => e.length);
    await page.close();
  }

  // ---- 2. 全ゲームを並列で完走(完璧なボット) ----
  const games = ['switch','gonogo','oddone','nback','span','spanrev','ufov','dual','compare','stroop','schulte','picmem'];
  const t1 = Date.now();
  const perfect = await Promise.all(games.map(g => playOne(browser, g, false, 'g_' + g).catch(e => ({ error: String(e) }))));
  report.perfectSecs = Math.round((Date.now() - t1) / 1000);
  report.perfect = {};
  games.forEach((g, i) => { const x = perfect[i]; report.perfect[g] = x.error ? x : { screen: x.screen, correct: x.r.correct, total: x.r.total, score: x.r.score, lv: x.r.lvBefore + '->' + x.r.lvAfter, plays: x.plays, newBest: x.r.newBest, avgRT: x.r.avgRT && Math.round(x.r.avgRT), lines: x.r.lines.map(l => l.l + '=' + l.v).join(' / '), resultText: x.hasText }; });

  // ---- 3. わざと全部まちがえるボット(レベル低下・得点0の確認) ----
  const bad = await Promise.all(['compare', 'switch', 'nback', 'stroop', 'picmem'].map(g => playOne(browser, g, true, 'bad_' + g).catch(e => ({ error: String(e) }))));
  report.bad = {};
  ['compare', 'switch', 'nback', 'stroop', 'picmem'].forEach((g, i) => { const x = bad[i]; report.bad[g] = x.error ? x : { correct: x.r.correct, total: x.r.total, score: x.r.score, lv: x.r.lvBefore + '->' + x.r.lvAfter }; });

  // ---- 4. 画面遷移・保存・シート・リセット ----
  {
    const page = await newPage(browser);
    await pickAge(page, '20');
    await page.click('[data-act=tab][data-v=records]');
    await page.screenshot({ path: SHOT + '04_records_empty.png', fullPage: true });
    await page.click('[data-act=tab][data-v=settings]');
    await page.screenshot({ path: SHOT + '05_settings.png', fullPage: true });
    await page.click('[data-act=toggle-sound]');
    report.soundOn = await page.$eval('.switch', b => b.getAttribute('aria-checked'));
    await page.click('[data-act=toggle-sound]');
    await page.click('[data-act=tab][data-v=home]');
    // 中断シート
    await page.click('[data-act=play][data-g="nback"]');
    await page.screenshot({ path: SHOT + '06_intro.png', fullPage: true });
    await page.click('[data-act=begin]');
    await sleep(2200);
    await page.click('[data-act=quit]');
    report.quitSheet = await page.$$eval('#layer .sheet', e => e.length);
    await page.screenshot({ path: SHOT + '07_quit.png' });
    await page.click('#layer [data-act=home]');
    report.afterQuitScreen = await page.evaluate(() => window.__dojo.ui().screen);
    report.playsAfterQuit = await page.evaluate(() => JSON.stringify(window.__dojo.save().plays));
    // 年代シート
    await page.click('[data-act=open-age]');
    await page.screenshot({ path: SHOT + '08_agesheet.png' });
    await page.keyboard.press('Escape');
    report.sheetClosedByEsc = await page.$$eval('#layer .sheet', e => e.length === 0);
    await page.close();
  }

  // ---- 5. 保存の永続化・リセット・横幅あふれ ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror(5): ' + e.message));
    await page.goto(URL);
    await pickAge(page, '10');
    await page.click('[data-act=play][data-g="compare"]');
    await page.click('[data-act=begin]');
    await botLoop(page, false, null);
    await page.click('[data-act=home]');
    await page.reload();
    report.persisted = await page.evaluate(() => ({ screen: window.__dojo.ui().screen, age: window.__dojo.save().age, hist: window.__dojo.save().history.length, plays: window.__dojo.save().plays.compare }));
    await page.click('[data-act=tab][data-v=records]');
    await page.screenshot({ path: SHOT + '09_records_after.png', fullPage: true });
    await page.click('[data-act=tab][data-v=home]');
    await page.screenshot({ path: SHOT + '10_home_after.png', fullPage: true });
    // 横スクロールの有無(390 / 320 / 480 / 1100)
    report.overflow = {};
    for (const w of [320, 390, 480, 1100]) {
      await page.setViewportSize({ width: w, height: 800 });
      const o = {};
      for (const tab of ['home', 'records', 'settings']) {
        await page.click('[data-act=tab][data-v=' + tab + ']');
        o[tab] = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      }
      report.overflow[w] = o;
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // リセット
    await page.click('[data-act=tab][data-v=settings]');
    await page.click('[data-act=reset-ask]');
    await page.screenshot({ path: SHOT + '11_reset.png' });
    await page.click('[data-act=reset-do]');
    report.afterReset = await page.evaluate(() => ({ screen: window.__dojo.ui().screen, age: window.__dojo.save().age, hist: window.__dojo.save().history.length }));
    await ctx.close();
  }

  // ---- 6. 3ゲーム連続セッション(40代)+ 3分モード(30代) ----
  {
    const page = await newPage(browser);
    await pickAge(page, '40');
    await page.click('[data-act=start-session]');
    for (let i = 0; i < 3; i++) {
      await page.click('[data-act=begin]');
      await botLoop(page, false, i === 0 ? 's_first' : null);
      if (i < 2) await page.click('[data-act=next]');
    }
    report.sessionGresultButton = await page.$eval('[data-act=next]', b => b.textContent);
    await page.click('[data-act=next]');
    report.sessionScreen = await page.evaluate(() => window.__dojo.ui().screen);
    await page.screenshot({ path: SHOT + '12_session_result.png', fullPage: true });
    await page.click('[data-act=home]');
    await page.screenshot({ path: SHOT + '13_home_done.png', fullPage: true });
    report.homeDoneText = await page.innerText('.hero');
    await page.close();
  }

  await browser.close();
  report.problems = problems;
  report.externalRequests = external;
  fs.writeFileSync(BASE + '/tests/report_v3.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
