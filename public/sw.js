// Service worker: deja la app disponible sin internet (offline-first).
const CACHE = "tradex-v112";
const SHELL = [
  "/", "/index.html", "/css/styles.css", "/manifest.webmanifest", "/icons/icon.svg",
  "/js/app.js", "/js/db.js", "/js/clientdb.js", "/js/utils.js", "/js/ui.js", "/js/alerts.js", "/js/assistant.js", "/js/receipt.js",
  "/js/views/dashboard.js", "/js/views/orders.js", "/js/views/clients.js", "/js/views/loyalty.js", "/js/loyalty.js", "/js/views/suppliers.js", "/js/views/products.js", "/js/views/combos.js",
  "/js/views/quote.js", "/js/views/cuotas.js", "/js/views/personal.js", "/js/suggest.js", "/js/moneyinput.js", "/js/worktime.js", "/js/categories.js", "/js/todos.js", "/js/views/calendar.js", "/js/views/agenda.js", "/js/views/billing.js", "/js/views/finance.js", "/js/views/stats.js", "/js/views/settings.js",
  "/js/places.js", "/vendor/localidades.json", "/vendor/pdf.min.mjs", "/vendor/pdf.worker.min.mjs",
];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero (para ver siempre lo último) y caché si no hay conexión. La API de IA nunca se cachea.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (url.origin === location.origin || url.hostname.includes("fonts."))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow("/#/agenda"))));
});
