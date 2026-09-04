const CACHE='ret-pwa-v5';
const SHELL=['/','/index.html','/manifest.webmanifest','/icons/ret-192.png','/icons/ret-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);

  // Never cache authenticated API responses.
  if(url.pathname.startsWith('/api/')){
    event.respondWith(fetch(req));
    return;
  }

  // Navigation: fresh site first, cached shell only if network is unavailable.
  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req).then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put('/index.html',copy));
        return r;
      }).catch(()=>caches.match('/index.html'))
    );
    return;
  }

  // Same-origin static assets: cache-first + background refresh.
  if(url.origin===self.location.origin){
    event.respondWith(
      caches.match(req).then(cached=>{
        const fresh=fetch(req).then(r=>{
          if(r.ok)caches.open(CACHE).then(c=>c.put(req,r.clone()));
          return r;
        }).catch(()=>cached);
        return cached||fresh;
      })
    );
  }
});
