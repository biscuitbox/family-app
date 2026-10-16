// sw.js — 홈 화면 앱으로 설치했을 때 인터넷이 잠깐 끊겨도 화면이 열리게 한다.
// 앱 파일을 고친 뒤 배포할 때는 VERSION 숫자를 하나 올리세요.
const VERSION = 'ugh-v8';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'config.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 우리 앱 파일: 네트워크 먼저, 안 되면 저장해 둔 것. Firebase·글꼴 요청은 건드리지 않는다.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
