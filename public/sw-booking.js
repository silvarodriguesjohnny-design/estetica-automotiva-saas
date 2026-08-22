const CACHE = 'aef-booking-v1'
const ASSETS = ['/', '/src/main.tsx']

self.addEventListener('install', e => {
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  // Estratégia network-first para API, cache-first para assets estáticos
  if (e.request.url.includes('/rest/v1/') || e.request.url.includes('/functions/v1/')) {
    return // deixa passar sem cache
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, clone))
        return res
      })
      .catch(() => caches.match(e.request))
  )
})
