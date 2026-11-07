/* 脳トレ道場 サービスワーカー
   目的: 電波がなくても開けるようにする。
   外部には通信しない。自分のサイトのファイルを保存するだけ。
   __BUILD__ は、デプロイ時にコミットの識別子へ置き換わる(版が変わると、古い保存分が消える)。 */
const BUILD = '__BUILD__';
const CACHE = 'brain-dojo-' + BUILD;
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) {
        return Promise.all(ks.filter(function (k) { return k.indexOf('brain-dojo-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (new URL(r.url).origin !== self.location.origin) return; // 外部のものには触らない
  if (r.mode === 'navigate') {
    // ページ: 通信できるときは最新を取り、できないときは保存分を使う
    e.respondWith(
      fetch(r).then(function (res) {
        if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, cp); }); }
        return res;
      }).catch(function () {
        return caches.match(r, { ignoreSearch: true }).then(function (m) { return m || caches.match('./index.html'); });
      })
    );
    return;
  }
  // そのほか(アイコンなど): 保存分を先に使う
  e.respondWith(
    caches.match(r).then(function (m) {
      return m || fetch(r).then(function (res) {
        if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, cp); }); }
        return res;
      });
    })
  );
});
