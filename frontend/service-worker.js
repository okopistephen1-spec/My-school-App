const CACHE_NAME = "smoothplays-v2";

const APP_FILES = [
    "/",
    "/index.html",
    "/manifest.json",
    "/css/style.css",
    "/js/songs.js",
    "/images/icon-192.png",
    "/images/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES))
    );

    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) =>
            Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            )
        )
    );

    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Let API requests go directly to the backend.
    if (url.pathname.startsWith("/api/")) {
        return;
    }

    // Handle only requests belonging to this frontend.
    if (url.origin !== self.location.origin) {
        return;
    }

    if (request.method !== "GET") {
        return;
    }

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(request).then((response) => {
                if (response.ok) {
                    const responseCopy = response.clone();

                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseCopy);
                    });
                }

                return response;
            });
        })
    );
});