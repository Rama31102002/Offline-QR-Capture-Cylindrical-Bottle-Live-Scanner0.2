'use strict';
const CACHE_PREFIX='offline-qr-cylindrical-live-scanner-';
const CACHE=CACHE_PREFIX+'0.2';
const ASSETS=['./','./index.html','./offline.html','./manifest.json','./assets/style.css','./assets/time.js','./assets/db.js','./assets/auth.js','./assets/camera.js','./assets/dewarp.js','./assets/label-schema.js','./assets/scanner-worker.js','./assets/qr-reader.js','./assets/backup.js','./assets/app.js','./assets/jszip.min.js','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{const copy=r.clone();if(new URL(e.request.url).origin===self.location.origin)caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match('./offline.html'))));});
