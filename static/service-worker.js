const CACHE_NAME = "smoothplays-v1";

const APP_FILES = [
    "/",
    "/static/manifest.json",
    "/static/css/style.css",
    "/static/js/songs.js",
    "/static/images/icon-192.png",
    "/static/images/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(APP_FILES);
        })
    );

    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name.startsWith("smoothplays-") && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );

    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Only handle requests from this website.
    if (url.origin !== self.location.origin) {
        return;
    }

    // Always fetch API data from the server.
    if (url.pathname.startsWith("/api/")) {
        return;
    }

    // Try the network first, then use the cached version if offline.
    if (request.method === "GET") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, copy);
                        });
                    }

                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(request);

                    if (cached) {
                        return cached;
                    }

                    throw new Error("You are offline and this page is not cached.");
                })
        );
    }
});