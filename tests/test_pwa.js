// PWA の検証。公開と同じ形(サブパス付き)で組み立て、サーバーで配り、マニフェスト・サービスワーカー・オフライン起動を確認する。
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const BASE = path.resolve(__dirname, '..');
const PREFIX = '/noo-training-game-app/';
const problems = [], external = [], checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) problems.push('NG: ' + name + (detail ? ' ' + JSON.stringify(detail) : '')); };

const site = fs.mkdtempSync(path.join(os.tmpdir(), 'bd_site_'));
cp.execFileSync('bash', [path.join(BASE, 'scripts/build_site.sh'), site, 'testbuild'], { stdio: 'inherit' });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(PREFIX)) { res.writeHead(404); return res.end('not found'); }
  let rel = u.slice(PREFIX.length) || 'index.html';
  const f = path.join(site, rel);
  if (!f.startsWith(site) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const root = origin + PREFIX;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
  page.on('request', r => { if (!r.url().startsWith(origin) && !/^(data:|blob:|about:)/.test(r.url())) external.push(r.url()); });

  // ---- 組み立てた中身 ----
  const files = fs.readdirSync(site);
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', '.nojekyll']) check('公開物に ' + f, files.includes(f));
  const swText = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
  check('sw.js のビルド識別子が置き換わる', !swText.includes('__BUILD__') && swText.includes("'testbuild'"));
  const idx = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  check('index.html に manifest と apple-touch-icon', idx.includes('rel="manifest"') && idx.includes('rel="apple-touch-icon"'));

  // ---- 表示・マニフェスト ----
  await page.goto(root);
  check('画面が表示される', (await page.innerText('#app')).includes('あなたの年代は'));
  const man = await page.evaluate(async () => {
    const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); const j = await r.json();
    const icons = [];
    for (const i of j.icons) { const ir = await fetch(new URL(i.src, l.href)); const bm = await createImageBitmap(await ir.blob()); icons.push({ src: i.src, status: ir.status, w: bm.width, h: bm.height, sizes: i.sizes }); }
    const at = document.querySelector('link[rel=apple-touch-icon]'); const ar = await fetch(at.href);
    return { status: r.status, j, icons, apple: ar.status };
  });
  check('manifest が取得できる', man.status === 200 && man.j.name === '脳トレ道場' && man.j.display === 'standalone' && man.j.start_url === './' && man.j.lang === 'ja', man.j);
  check('アイコンの大きさが宣言どおり', man.icons.length >= 2 && man.icons.every(i => i.status === 200 && `${i.w}x${i.h}` === i.sizes), man.icons);
  check('apple-touch-icon が取得できる', man.apple === 200);

  // ---- サービスワーカー ----
  const ready = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active && r.scope; });
  check('サービスワーカーが有効になる', !!ready, ready);
  check('スコープがサイトの配下', typeof ready === 'string' && ready === root, ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
  const cacheNames = await page.evaluate(() => caches.keys());
  check('保存先の名前にビルド識別子', cacheNames.includes('brain-dojo-testbuild'), cacheNames);

  // ---- オフライン ----
  await ctx.setOffline(true);
  await page.reload();
  check('オフラインでも開ける(ルート)', (await page.innerText('#app')).includes('あなたの年代は'));
  await page.goto(root + 'index.html');
  check('オフラインでも開ける(index.html)', (await page.innerText('#app')).includes('あなたの年代は'));
  await page.click('.agecard >> nth=1');
  await page.click('button.btn');
  check('オフラインでホームまで進める', (await page.innerText('#app')).includes('今日のメニュー'));
  await ctx.setOffline(false);

  // ---- 古い保存分の入れ替え ----
  await page.evaluate(() => caches.open('brain-dojo-old').then(c => c.put('/x', new Response('x'))));
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.unregister(); });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
  const names2 = await page.evaluate(() => caches.keys());
  check('古い版の保存分は消える', !names2.includes('brain-dojo-old') && names2.includes('brain-dojo-testbuild'), names2);

  await browser.close(); server.close();
  const report = { passed: checks.filter(c => c.ok).length, total: checks.length, problems, externalRequests: external };
  console.log(JSON.stringify(report, null, 2));
  process.exit(problems.length || external.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); try { server.close(); } catch (_) {} process.exit(1); });
