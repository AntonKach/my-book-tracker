const CACHE_NAME = 'my-book-tracker-v8';
const ASSETS = ['./','./index.html','./index.css','./app.js','./js/api.js','./js/scanner.js','./js/domain.js','./js/library-store.js','./js/cloud.js','./js/import-export.js','./js/ui.js','./vendor/html5-qrcode.min.js','./manifest.json','./icons/icon-192.png','./icons/icon-512.png'];
const allowed = new Set(ASSETS.map(path=>new URL(path,self.location.href).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS.map(path=>new Request(path,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('my-book-tracker-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||!allowed.has(event.request.url))return;
 event.respondWith(fetch(event.request,{cache:'no-cache'}).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy)));}return response;}).catch(async()=>await caches.match(event.request)||Response.error()));
});
