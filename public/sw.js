const CACHE = 'alchemist-shop-rabbit-trials-39';
const CORE = [
  './',
  './index.html',
  './sandbox.html',
  './public/game.css',
  './public/toon.css',
  './public/hud.css',
  './public/rabbit-trials.css',
  './src/game/RabbitAssets.mjs',
  // Cache the complete brewing import graph before the first offline reload.
  './src/game/FluidSurfaceGPU.mjs',
  './src/materials/MaterialDefinition.mjs',
  './src/materials/MaterialGenerator.mjs',
  './src/materials/MaterialSampler.mjs',
  './src/performance/AdaptiveQuality.mjs',
  './src/reactions/ReactionEngine.mjs',
  './src/rendering/GraphicsSettings.mjs',
  './src/rendering/PlanarRenderer.mjs',
  './src/simulation/BuoyancySolver.mjs',
  './src/simulation/CombustionSolver.mjs',
  './src/simulation/DensityStratification.mjs',
  './src/simulation/ElectricalSolver.mjs',
  './src/simulation/FluidSolver.mjs',
  './src/simulation/MoldSystem.mjs',
  './src/simulation/ParticleSystem.mjs',
  './src/simulation/Phase.mjs',
  './src/simulation/PhaseSolver.mjs',
  './src/simulation/PowderSolver.mjs',
  './src/simulation/SimulationEngine.mjs',
  './src/simulation/SolidSolver.mjs',
  './src/simulation/SpatialGrid.mjs',
  './src/simulation/ThermalSolver.mjs',
  './src/simulation/math.mjs',
  './public/assets/rabbit-trials/01_rabbits/portrait_moon.png',
  './public/assets/rabbit-trials/01_rabbits/rabbit_clover_card.png',
  './public/assets/rabbit-trials/01_rabbits/rabbit_hazel_card.png',
  './public/assets/rabbit-trials/01_rabbits/rabbit_moon_card.png',
  './public/assets/rabbit-trials/01_rabbits/rabbit_pepper_card.png',
  './public/assets/rabbit-trials/02_ui_frames/caption_plaque.png',
  './public/assets/rabbit-trials/02_ui_frames/card_default.png',
  './public/assets/rabbit-trials/02_ui_frames/card_selected.png',
  './public/assets/rabbit-trials/02_ui_frames/dose_dropdown.png',
  './public/assets/rabbit-trials/02_ui_frames/gold_corner_ornament.png',
  './public/assets/rabbit-trials/02_ui_frames/header_main.png',
  './public/assets/rabbit-trials/02_ui_frames/panel_comparison.png',
  './public/assets/rabbit-trials/02_ui_frames/panel_details.png',
  './public/assets/rabbit-trials/02_ui_frames/panel_dose.png',
  './public/assets/rabbit-trials/02_ui_frames/panel_instructions.png',
  './public/assets/rabbit-trials/02_ui_frames/scrollbar_horizontal_gold.png',
  './public/assets/rabbit-trials/02_ui_frames/scrollbar_horizontal_track.png',
  './public/assets/rabbit-trials/02_ui_frames/status_tag.png',
  './public/assets/rabbit-trials/02_ui_frames/viewport_tab.png',
  './public/assets/rabbit-trials/03_buttons/button_close.png',
  './public/assets/rabbit-trials/03_buttons/button_danger.png',
  './public/assets/rabbit-trials/03_buttons/button_danger_hover.png',
  './public/assets/rabbit-trials/03_buttons/button_default.png',
  './public/assets/rabbit-trials/03_buttons/button_disabled.png',
  './public/assets/rabbit-trials/03_buttons/button_hover.png',
  './public/assets/rabbit-trials/03_buttons/button_pressed.png',
  './public/assets/rabbit-trials/03_buttons/button_primary.png',
  './public/assets/rabbit-trials/04_icons/book_open.png',
  './public/assets/rabbit-trials/04_icons/cage.png',
  './public/assets/rabbit-trials/04_icons/chevron_down.png',
  './public/assets/rabbit-trials/04_icons/close_x.png',
  './public/assets/rabbit-trials/04_icons/potion_blue.png',
  './public/assets/rabbit-trials/04_icons/potion_amber.png',
  './public/assets/rabbit-trials/04_icons/rabbit_skull.png',
  './public/assets/rabbit-trials/05_environment/trial_room_background_empty.png',
  './src/game/hud.mjs',
  './public/hud/clean-vial.png',
  './public/hud/coin.png',
  './public/hud/customer-portrait.png',
  './public/hud/flame.png',
  './public/hud/frame-card.png',
  './public/hud/frame-counter.png',
  './public/hud/frame-disabled.png',
  './public/hud/frame-dose-selected.png',
  './public/hud/frame-parchment.png',
  './public/hud/frame-primary.png',
  './public/hud/frame-scene.png',
  './public/hud/frame-selected.png',
  './public/hud/frame-tool.png',
  './public/hud/frame-wide.png',
  './public/hud/frost.png',
  './public/hud/garden.png',
  './public/hud/ingredients.png',
  './public/hud/pestle-mortar.png',
  './public/hud/plain-water.png',
  './public/hud/potion-id.png',
  './public/hud/recipe-book.png',
  './public/hud/reputation.png',
  './public/hud/settings-gear.png',
  './public/hud/stir-spoon.png',
  './public/hud/trials.png',
  './public/fonts/guild-pixel.woff',
  './public/icons/alchemist.svg',
  './src/game/main.mjs',
  './src/game/contracts.mjs',
  './src/game/world.mjs',
  './src/game/effects.mjs',
  './src/game/sandboxProperties.mjs',
  './src/game/magicLight.mjs',
  './src/game/LiquidFunFluid.mjs',
  './public/vendor/liquidfun.js',
  './public/vendor/LIQUIDFUN-LICENSE.txt',
  './src/game/gathering.mjs',
  './src/game/experiments.mjs',
  './src/game/potionTransfer.mjs',
  './src/game/knowledge.mjs',
  './src/game/potionId.mjs',
  './src/game/commerce.mjs',
  './src/game/TestingRenderer.mjs',
  './src/game/rabbits.mjs',
  './src/game/RabbitRenderer.mjs',
  './src/game/RabbitMotion.mjs',
  './src/game/RabbitPixelArt.mjs',
  './src/simulation/ArcaneSolver.mjs',
  './src/game/potion.mjs',
  './src/game/brewing.mjs',
  './src/game/cauldron.mjs',
  './src/game/CauldronThermal.mjs',
  './src/simulation/GasDensitySolver.mjs',
  './src/reactions/MixtureSolver.mjs',
  './src/game/orders.mjs',
  './src/game/evaluation.mjs',
  './src/game/economy.mjs',
  './src/game/persistence.mjs',
  './src/game/LaboratoryRenderer.mjs',
  './src/game/MaterialRaster.mjs',
  './src/game/art.mjs',
  './src/game/audio.mjs',
  './styles.css',
  './public/base.css',
  './public/desktop.css',
  './public/fixes.css',
  './public/manifest.webmanifest',
  './public/icons/icon.svg',
  './src/app/main.mjs',
  './sw.js',
  './public/sw.js'
].map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('fluid-pocket-') || key.startsWith('alchemist-shop-')) && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  const networkFirst = event.request.mode === 'navigate' || /\.(?:mjs|js|css|html)$/.test(url.pathname);
  if (networkFirst) {
    event.respondWith(fetch(event.request, { cache: "reload" }).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(event.request, { ignoreSearch: true })));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
    }
    return response;
  })));
});


