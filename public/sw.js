/* public/sw.js */
/* Versión: 2025-10-15 — notificaciones + click-to-open conversación */
const CACHE_NAME = "crm-cache-v1";
const APP_SHELL = [ "/", "/index.html" ];

/** Instalar: precache mínimo opcional */
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try { await cache.addAll(APP_SHELL); } catch (_) {}
    self.skipWaiting();
  })());
});

/** Activar: limpiar caches viejos */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)));
    self.clients.claim();
  })());
});

/** Util: abrir/focalizar la app en la conversación */
async function openConversation(conversationId, fallbackUrl) {
  const url = conversationId
    ? new URL(`/home/${encodeURIComponent(conversationId)}`, self.location.origin).href
    : (fallbackUrl || new URL("/home", self.location.origin).href);

  const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  // Intentar reusar una pestaña existente
  for (const client of allClients) {
    const urlObj = new URL(client.url);
    if (urlObj.origin === self.location.origin) {
      try {
        await client.focus();
        if (client.url !== url) client.postMessage({ __SW_NAVIGATE__: url });
      } catch (_) {}
      return;
    }
  }

  // Si no hay ninguna, abrir una nueva
  try {
    await self.clients.openWindow(url);
  } catch (_) {}
}

/** PUSH: mostrar notificación (venga de FCM o de tu backend) */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); } catch {
    data = { notification: { title: "Nuevo mensaje", body: event.data.text() }, data: {} };
  }

  // Soporta:
  // - FCM: { notification:{title,body,icon}, data:{conversationId,url,...} }
  // - Custom: { title, body, icon, url, conversationId }
  const n = data.notification || {};
  const d = data.data || data;

  const title = n.title || data.title || "Nuevo mensaje";
  const body  = n.body  || data.body  || "Tocá para abrir la conversación";
  const icon  = n.icon  || data.icon  || "/icons/icon-192.png";

  const conversationId = d.conversationId || d.convId || null;
  const url = d.url || null;

  const tag = conversationId ? `conv-${conversationId}` : "crm-msg";
  const badge = "/icons/badge-72.png";

  const options = {
    body,
    icon,
    badge,
    tag,
    requireInteraction: false,
    renotify: true,
    data: { conversationId, url },
    actions: [
      // { action: "open", title: "Abrir" }
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/** CLICK en notificación → abrir/focalizar la conversación */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { conversationId, url } = event.notification.data || {};
  const p = openConversation(conversationId, url);
  event.waitUntil(p);
});

/** Mensajes desde la página para pedir navegación (lo usamos arriba) */
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg && msg.__SW_NAVIGATE__) {
    // Lo maneja la página (Home.jsx escucha este mensaje y hace navigate)
  }
});
