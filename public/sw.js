/*
 * Service worker de PÁDEL 86 : rend le jeu installable et jouable hors ligne.
 * - À l'installation : met en cache la page et les fichiers qu'elle référence.
 * - Page (navigation) : réseau d'abord, pour recevoir les mises à jour ; cache si hors ligne.
 * - Fichiers /assets/ : leur nom contient une empreinte, donc cache d'abord.
 * Changer CACHE force le remplacement de l'ancien cache.
 */
const CACHE = 'padel86-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch('./', { cache: 'no-cache' });
      const html = await res.clone().text();
      await cache.put('./', res);
      const urls = new Set([
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/apple-touch-icon.png',
        'padel86/padel86-sprites-1x.png',
        'padel86/padel86-affiche-1x.png',
        'padel86/padel86-titre-noblink-1x.png',
        ...['coin', 'hit', 'vitre', 'smash', 'point', 'faute', 'victoire', 'defaite'].map((n) => `padel86/sfx/${n}.mp3`),
      ]);
      for (const m of html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)) urls.add(m[1]);
      await Promise.all([...urls].map((u) => cache.add(u).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // La musique est lue par morceaux (requêtes Range) : on laisse le réseau s'en charger,
  // servir un fichier entier depuis le cache casse la lecture sur Safari. Hors ligne : pas de thème.
  if (req.headers.has('range')) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) await cache.put('./', fresh.clone());
          return fresh;
        } catch {
          return (await cache.match('./')) ?? Response.error();
        }
      }
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })(),
  );
});
