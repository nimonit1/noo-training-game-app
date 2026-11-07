// アイコン(PNG)を作る。使い方: node scripts/make_icons.js
// 図柄は、アプリ内の脳のマーク(ティール地に白丸、珊瑚色のワンポイント)。マスカブル(丸く切り抜かれても欠けない)の余白を取っている。
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.resolve(__dirname, '..', 'pwa');
const BRAIN = '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V4a3 3 0 0 0-3 0z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">' +
  '<rect width="512" height="512" fill="#0F766E"/>' +
  '<circle cx="256" cy="256" r="170" fill="#E3F3F1"/>' +
  '<g transform="translate(145 145) scale(9.25)" fill="none" stroke="#0F766E" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + BRAIN + '</g>' +
  '<circle cx="376" cy="136" r="26" fill="#E0603A"/></svg>';
(async () => {
  const b = await chromium.launch();
  for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent('<body style="margin:0">' + svg + '</body>');
    await p.screenshot({ path: path.join(OUT, name) });
    await p.close();
    console.log('作成:', name, size + 'px');
  }
  await b.close();
})();
