/* RepoShield does not use a service worker. This file exists so update
   checks for leftover registrations return 200, then self-unregister. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration
      .unregister()
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => {
        for (const client of clients) {
          if ("navigate" in client) client.navigate(client.url);
        }
      }),
  );
});
