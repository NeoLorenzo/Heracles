const CACHE_NAME = "heracles-v49";
const APP_SHELL = [
  "/",
  "/index.html",
  "/fabbro-design/fabbro-tokens.css",
  "/styles.css?v=26",
  "/public.css?v=4",
  "/app.css?v=1",
  "/app.js?v=37",
  "/features/public-showcase.js?v=2",
  "/analytics.js",
  "/presets.js",
  "/preset-ordering.js",
  "/body-weight.js",
  "/features/activity-heatmap.js",
  "/features/body-weight.js",
  "/features/body-circumference.js",
  "/features/dashboard.js",
  "/features/presets.js",
  "/features/preset-order-settings.js",
  "/features/pull-to-refresh.js",
  "/features/session/session-storage.js",
  "/features/session/session-history-context.js",
  "/features/session/session-autosave.js",
  "/features/session/session-rendering.js",
  "/features/session/session-recents.js",
  "/features/session/session-controller.js",
  "/features/session/preset-order-inputs.js",
  "/features/session/history-correction.js",
  "/features/session/session-lifecycle.js",
  "/relative-e1rm.js",
  "/set-model.js",
  "/literature.js",
  "/config.js",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE_CANONICAL.csv",
  "/icons/icon.svg",
  "/brand/heracles-mark.svg",
  "/brand/heracles-lockup.svg",
  "/brand/fabbro-mark.svg",
  "/docs/CURRENT_LIMITATIONS_OF_MUSCLE_GROUP_MAPPING.md",
  "/docs/DESIGN_RULES.md",
  "/docs/BODY_WEIGHT_DATA.md",
  "/docs/MUSCLE_GROUP_TAXONOMY.md",
  "/docs/PRESET_EXERCISE_ORDER.md",
  "/docs/EXERCISE_MUSCLE_COMPOSITION.md",
  "/docs/EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.md",
  "/docs/MOVEMENT_PATTERN_COEFFICIENTS.md",
  "/docs/MOVEMENT_PATTERN_DATA_MODEL.md",
  "/docs/RESISTANCE_TRAINING_OUTCOME_STUDY_SELECTION_PROTOCOL.md",
  "/docs/WHY_THE_APP_DOES_NOT_TRACK_TONNAGE.md",
  "/docs/MOVEMENT_PATTERN_TO_MUSCLE_FUNCTION.md",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match("/index.html"))),
  );
});
