const CACHE = 'family-travel-hub-v13';
const CORE = [
  './','./index.html','./css/app.css','./js/app.js','./js/api.js','./js/db.js','./js/state.js','./manifest.webmanifest','./assets/icons/icon-192.png','./assets/icons/icon-512.png'
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  const req=event.request; if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/')) return;
  if(url.origin!==self.location.origin) return;
  event.respondWith(fetch(req).then(res => { const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{}); return res; }).catch(()=>caches.match(req).then(hit=>hit||caches.match('./index.html'))));
});
