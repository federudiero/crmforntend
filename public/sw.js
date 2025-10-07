// /sw.js
const CACHE_NAME = "crmhogarcril-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Navegación: online primero, fallback a HTML cacheado
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }

  // Estáticos: cache primero, luego red
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});

// =============================
// Firebase Cloud Messaging - push & click handlers
// =============================
self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : null;
    const title = data?.notification?.title || data?.title || 'Nuevo mensaje';
    const body = data?.notification?.body || data?.body || 'Tienes una actualización';
    const icon = data?.notification?.icon || '/icons/icon-192.png';
    const url = data?.data?.url || data?.fcmOptions?.link || '/home';
    const tag = data?.notification?.tag || 'crm-notif';
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon,
        tag,
        data: { url },
      })
    );
  } catch (e) {
    event.waitUntil(
      self.registration.showNotification('Nuevo evento', {
        body: 'Tienes una actualización',
        tag: 'crm-notif',
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/home';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
