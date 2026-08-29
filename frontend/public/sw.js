/* S17 修订：Service Worker 自卸载。
 * 背景：SW 缓存独立于 HTTP 缓存，改版后旧 SW 会一直返回缓存的旧 index.html/chunk，
 * 且强刷（Ctrl+Shift+R）清不掉 SW 缓存，导致部署新版本后用户看不到更新。
 * 本系统为内网在线使用，离线价值有限；为彻底避免"改了看不到新版本"，
 * 此 SW 一旦安装即：清空全部缓存 → 注销自身 → 不拦截任何请求。
 * 之后页面走正常 HTTP 缓存策略（index.html no-cache，hash 资源 immutable）。
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister()),
  );
  self.clients.claim();
});

// 不注册 fetch 拦截：所有请求直接走网络，避免任何一层旧缓存。
