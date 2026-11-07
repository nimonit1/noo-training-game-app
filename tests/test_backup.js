// 記録の書き出し・読み込みの検証。不正なファイルや悪意のあるファイルを読み込ませても、記録が壊れず、スクリプトが動かないことを確認する。
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const URL = 'file://' + require('./_latest').file;
const KEY = 'brainDojo_v1';
const problems = [], external = [], checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) problems.push('NG: ' + name + (detail ? ' ' + JSON.stringify(detail) : '')); };

const sample = {
  age: '30', goal: 'memory', sound: true,
  days: { '2026-11-05': 2, '2026-11-06': 3 },
  best: { nback: 1800, span: 1200 }, level: { nback: 4, span: 3 }, plays: { nback: 3, span: 2 },
  history: [
    { d: '2026-11-06', t: 1762400000000, g: 'nback', n: 'ナンバーバック', acc: 90, s: 1700, lv: 3 },
    { d: '2026-11-05', t: 1762300000000, g: 'span', n: '位置おぼえ', acc: 70, s: 900, lv: 3 }
  ],
  lastExport: null
};
const wrap = data => ({ format: 'brainDojo-backup', version: 1, exportedAt: '2026-11-07T00:00:00Z', data });
const clone = o => JSON.parse(JSON.stringify(o));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
  page.on('request', r => { if (!/^(file:|data:|blob:|about:)/.test(r.url())) external.push(r.url()); });
  const saved = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__dojo.save())));
  const sheetText = () => page.evaluate(() => { const s = document.querySelector('#layer .sheet'); return s ? s.innerText : ''; });
  const toSettings = () => page.click('[data-act=tab][data-v=settings]');
  // ファイルを選び、確認(または失敗)のシートが出るまで待つ。読み取りは非同期のため
  const pick = async f => { await page.setInputFiles('#importFile', f); await page.waitForSelector('#layer .sheet', { timeout: 5000 }); };

  // ---- 1. 書き出し ----
  await page.goto(URL);
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, sample]);
  await page.reload();
  await toSettings();
  check('設定に「まだありません」', (await page.innerText('#app')).includes('まだありません'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
  check('ファイル名の形式', /^brain_dojo_backup_\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const tmp = path.join(os.tmpdir(), 'bd_backup_' + Date.now() + '.json');
  await dl.saveAs(tmp);
  const exported = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  check('format と version', exported.format === 'brainDojo-backup' && exported.version === 1);
  check('含まれる項目が決まっている', JSON.stringify(Object.keys(exported.data).sort()) === JSON.stringify(['age', 'best', 'days', 'goal', 'history', 'level', 'plays', 'sound']), Object.keys(exported.data));
  check('記録が同じ', JSON.stringify(exported.data.plays) === JSON.stringify(sample.plays) && exported.data.history.length === 2);
  check('書き出し日が表示される', /最後に書き出した日: \d{4}-\d{2}-\d{2}/.test(await page.innerText('#app')));
  check('lastExport が保存される', !!(await saved()).lastExport);

  // ---- 2. 読み込み(正常) ----
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check('消すと年代選択に戻る', (await page.evaluate(() => window.__dojo.ui().screen)) === 'select');
  await page.click('[data-act=pick-age][data-v="10"]');
  await page.click('[data-act=age-confirm]');
  await toSettings();
  await pick(tmp);
  let t = await sheetText();
  check('確認シートが出る', t.includes('この記録を読み込みますか'), t);
  check('確認シートに回数が出る', t.includes('プレイ回数: 5回') && t.includes('記録した日: 2日'), t);
  check('確認の時点では記録は変わらない', (await saved()).age === '10');
  await page.click('[data-act=import-cancel]');
  check('やめるで閉じる', (await sheetText()) === '' && (await saved()).age === '10');
  await pick(tmp);
  await page.click('[data-act=import-do]');
  const s1 = await saved();
  check('読み込み後の記録が同じ', s1.age === '30' && s1.goal === 'memory' && s1.sound === true && s1.plays.nback === 3 && s1.best.span === 1200 && s1.level.nback === 4 && s1.history.length === 2 && s1.days['2026-11-06'] === 3, s1);
  check('完了シート', (await sheetText()).includes('読み込みました'));
  await page.click('[data-act=close-sheet]');
  await page.reload();
  check('保存が残る', (await saved()).plays.nback === 3);
  await page.click('[data-act=tab][data-v=records]');
  check('記録画面が表示できる', (await page.innerText('#app')).includes('ナンバーバック'));
  await toSettings();

  // ---- 3. 読み込み(拒否) ----
  const before = JSON.stringify(await saved());
  const bad = [];
  const add = (name, buf) => bad.push([name, Buffer.isBuffer(buf) ? buf : Buffer.from(typeof buf === 'string' ? buf : JSON.stringify(buf))]);
  add('JSONではない', 'hello');
  add('format違い', { format: 'x', version: 1, data: {} });
  add('version違い', Object.assign(wrap(clone(sample)), { version: 99 }));
  let d = clone(sample); d.level.nback = 99; add('レベルが範囲外', wrap(d));
  d = clone(sample); d.age = '99'; add('年代が不正', wrap(d));
  d = clone(sample); d.history[0].acc = 'x'; add('結果の型が不正', wrap(d));
  d = clone(sample); d.days.evil = 1; add('日付が不正', wrap(d));
  d = clone(sample); d.best = [1, 2]; add('bestが配列', wrap(d));
  d = clone(sample); d.sound = 'yes'; add('soundが文字列', wrap(d));
  add('大きすぎる', Buffer.alloc(1100000, 'a'));
  for (const [name, buf] of bad) {
    await pick({ name: 'x.json', mimeType: 'application/json', buffer: buf });
    const tx = await sheetText();
    check('拒否: ' + name, tx.includes('読み込めませんでした'), tx.slice(0, 60));
    await page.click('[data-act=close-sheet]');
  }
  check('拒否しても記録は変わらない', JSON.stringify(await saved()) === before);

  // ---- 4. 悪意のあるファイル ----
  d = clone(sample);
  d.history[0].n = '<img src=x onerror="window.__pwned=1">';
  d.history.push({ d: '2026-11-04', t: 1, g: 'unknown_game', n: '<b>x</b>', acc: 1, s: 1, lv: 1 });
  d.best.unknown_game = 5;
  const evil = JSON.stringify(wrap(d)).replace('"best":{', '"best":{"__proto__":{"polluted":1},').replace('{"format"', '{"evil":"x","format"');
  await pick({ name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(evil) });
  await page.click('[data-act=import-do]');
  await page.click('[data-act=close-sheet]');
  const s2 = await saved();
  check('名前は定義済みの名前に置き換わる', s2.history[0].n === 'ナンバーバック', s2.history[0].n);
  check('未知のゲームは捨てる', s2.history.length === 2 && !('unknown_game' in s2.best));
  check('余計な項目は入らない', !('evil' in s2));
  check('プロトタイプ汚染なし', await page.evaluate(() => ({}).polluted === undefined));
  await page.click('[data-act=tab][data-v=records]');
  check('スクリプトは動かない', await page.evaluate(() => window.__pwned === undefined));

  // ---- 5. 年代なしのファイルは年代選択へ ----
  await toSettings();
  d = clone(sample); d.age = null; d.goal = null;
  await pick({ name: 'noage.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrap(d))) });
  await page.click('[data-act=import-do]');
  check('年代なしなら年代選択へ', (await page.evaluate(() => window.__dojo.ui().screen)) === 'select');

  await browser.close();
  const report = { file: require('./_latest').name, passed: checks.filter(c => c.ok).length, total: checks.length, problems, externalRequests: external };
  console.log(JSON.stringify(report, null, 2));
  process.exit(problems.length || external.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
