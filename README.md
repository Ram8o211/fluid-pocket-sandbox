# The Alchemist’s Shop

A playable medieval fantasy potion shop built on Fluid Pocket Sandbox’s real
particle engine. The game is entirely **2D**, mobile first, and statically hosted.

**Play:** https://ram8o211.github.io/fluid-pocket-sandbox/

Open a seeded world, gather plants and minerals, grind ingredients, and stir
them into plain water. Heat or cool the brew, test a small dose in the experiment
room, then inspect, bottle and sell it. Physical, magical and chemical effects
come from the resulting particles. Use profits for supplies, instruments,
larger cauldrons and rare ingredients. Progress, resource patches, experiment
records, recipes and the active cauldron save locally.

The fitted lid retains steam and ingredients. Turn off Flame or use Frost, then
wait for steam to condense before bottling. Flame and Frost enter through the
bottom; temperature and phase changes spread through neighbouring particles.
The lid warms with the pot, so a uniformly hot brew stays vapour until cooled.
Vapour always rises against a fixed reference atmosphere, retaining the different
reagents' densities. Trapped vapour concentrates under the lid; cool, concentrated
patches recondense first. With both sources off, hot or cold contents and copper
gradually return to room temperature (33 °A), including tiny residual droplets.
Compatible colours and properties diffuse through touching neighbours, with
visible fronts that spread faster under stirring and warmth. Disconnected regions
keep their own colour. Local exchange conserves measured ingredient proportions;
incompatible substances stay separate.
Four fine particles represent each ml, and the visible walls and lid share their
collision geometry, including clearance for each particle's full drawn radius.

The first commission teaches metered pouring and stirring. Whole plants and
stones enter as solids; **Grind & add** turns them into powder. A small amount
of compatible ground ingredient slowly dissolves in plenty of water. Lesser
dilution makes paste or dough. Loose mica dust is ready to add. Drag the spoon
or hold Stir, and tap Flame/Frost to cycle power. Local particle glows preview
strength, love, death, transformation, fire and frost. Acidity and poison travel
through the same mixing and sampling mechanism.

The nature room contains a spring, meadow, woodland and mineral banks. Gathering
uses real stock: emptied patches recover with elapsed time, including while the
game is closed. The experiment room has animals, a seedling and limestone;
each test consumes a measured 5 ml dose and records the observed changes.
**Ingredient sandbox** offers all ingredients and instruments with infinite
supplies, keeping its cauldron and experiment history separate from the shop.
Older saves preserve their pinned materials and customer targets.

Fine grains settle into compact, independent piles. Recent spoon work kneads
compatible powder and water into thick liquid dough; extra stirred solvent thins
it. Matter uses one-pixel texels at up to 768×464 in Crisp mode, following screen
density, or 384×232 in battery saver.

**Original sandbox:** https://ram8o211.github.io/fluid-pocket-sandbox/sandbox.html?mode=2D

The original 2D/3D simulation, material editor and experimental controls remain
available independently. The shop imports only the planar rendering path.

## Development and verification

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
npx playwright install --with-deps chromium --only-shell
npm run test:browser
npm run benchmark:game
```

`test:browser` plays two orders through visible controls, grinds raw ingredients,
checks thermal physics and save conservation, tests subjects, gathers and
depletes a resource patch, and verifies the separate infinite ingredient sandbox.
It also checks portrait/desktop layouts and opens the original sandbox. QA
screenshots go to the ignored `test-results/` directory. Set `SITE_URL` to run
against a deployed site; `BROWSER_PATH` selects an installed Chromium.
TypeScript and Playwright are development-only dependencies; the game has no
runtime dependency downloads or server requirements.

See [game architecture](docs/GAME_ARCHITECTURE.md) for contracts, quantity
conservation, fantasy measurements, scoring, progression and save migrations.
Physics is deliberately normalized and inspired by chemistry rather than a
calibrated model of real potion substances. Android hardware benchmarking remains
future validation. There is no cloud sync or native APK in this static MVP.

## Original Fluid Pocket Sandbox documentation

# Fluid Pocket Sandbox

Fluid Pocket Sandbox is a mobile-first procedural-matter sandbox with switchable 3D and lightweight 2D modes, designed for Chrome on Android. The phone acts conceptually as the container: changing the gravity vector with device orientation (or a touch fallback) changes how liquids, gases, and particle-cluster solids move inside a transparent box.

This MVP is intentionally an approximate physical sandbox, not a scientific CFD or chemistry solver. Its design goal is systemic causality: local properties cross thresholds, change phase or behavior, and create new local conditions that can trigger further transformations.

## Run

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

Open `http://localhost:4173`. The runtime itself has no npm/browser framework dependency; the MVP renderer is a zero-dependency raw WebGL point renderer; Three.js was deliberately omitted to remove first-load CDN/network cost and make the PWA self-contained. The static build is emitted to `dist/` and `vercel.json` points Vercel at that directory.

## Core architecture

- `src/simulation/`: SoA particle storage, dense spatial grid, fluid/solid/gas motion, thermal exchange, buoyancy, phase transitions, solid mechanics, electrical conduction, molds and combustion.
- `src/materials/`: material definitions, deterministic seeded generation, local material sampling/inspection, demo presets.
- `src/reactions/`: contact-gated mixing, property-distance intensity, thermal reactions and emergent fusion identities.
- `src/sensors/`: manual, device-orientation, and test gravity providers.
- `src/rendering/`: lightweight WebGL 3D rendering plus a dedicated Canvas2D planar renderer, with optional coarse density-cloud aggregation and reduced visual sampling.
- `src/performance/`: adaptive quality controller.
- `src/app/`: orchestration, save/export/import, responsive mobile/desktop controls.

The hot particle state is stored in parallel typed-array buffers. The grid stores per-cell linked lists, avoiding global O(N²) neighbor search.

## Material and phase model

Temperature is state, not an intrinsic material setting. New matter is placed at the current ambient temperature unless a preset explicitly supplies a spawn temperature. Its initial phase is selected from melting/boiling thresholds, so a material whose melting point is above ambient is emitted directly as a solid.

Materials expose density, viscosity, cohesion, miscibility, heat capacity, thermal conductivity, melting/boiling thresholds, volatility, reaction potential, reaction heat, crystallinity, solid subdivision, electrical conductivity/potential and an independent combustion threshold.

Solid subdivision separates low-subdivision coherent rigid clusters from high-subdivision granular solids. Granular solids dissipate motion and stabilize into piles rather than continuously recirculating like liquids. Melting collapses subdivision so a granular feedstock can become one continuous cast and remain coherent after refreezing. Crystallinity controls how strongly a newly frozen coherent solid relaxes toward an ordered local lattice versus preserving the shape present at solidification.

Molds are open-top collision objects that can receive liquid; after cooling below melting, low-subdivision matter retains the molded shape.

## Mixing, reactions and electricity

Two touching miscible materials converge locally rather than mutating their global presets. Completed fusion creates a distinct emergent material identity keyed by its source lineage. The Inspector can sample that local substance and save it into the reusable palette.

Reaction heat is independent from the abstract reaction potential. Thresholded property differences can therefore create exothermic or endothermic local responses. Conductive materials exchange electric potential through local contacts; potential remains a material/particle field and is exposed in debug visualization.

## Combustion

Combustion is an independent thermal threshold and may lie below melting, between melting and boiling, or above boiling. Once local temperature stays above it, matter is consumed progressively and releases heat. A completed combustion event deterministically derives two or three daughter materials from the parent properties. Daughter fractions sum to the consumed parent mass, so total particle mass is conserved. Products have reproducibly different optical, mechanical, thermal and electrical properties and can themselves be inspected and saved.

## 2D and 3D

The persistent 2D/3D switch changes both rendering and simulation dimension. 2D uses a dedicated Canvas2D renderer, removes z motion, collapses the spatial grid to one layer and reduces solver work. The planar box can be expanded to 60×60 simulation units. Entering 2D flattens existing matter onto z=0; returning to 3D does not invent lost depth.

## Controls and desktop

On mobile the interface remains tool-first: material + Draw/Erase/Inspect/Mold/View stay in the compact dock while detailed controls live in a collapsible sheet. Two fingers always override the active tool for view movement and pinch zoom.

On desktop (fine pointer, 900 px or wider) the same application switches to a dedicated workspace: left tool palette, right settings inspector, mouse-wheel zoom and right/middle-drag or Alt-drag camera override. Shortcuts: `1–5` tools, `H/C` thermal tools, `D` 2D/3D, `Space` pause, `R` reset view, `[`/`]` tool size and `Esc` close contextual panels.

## Performance and QA

Physics LOW/MEDIUM/HIGH remains separate from manual graphics settings. Eco rendering can aggregate matter into coarse density clouds; resolution, visual sampling, cloud size and reaction effects are independently adjustable. 2D additionally reduces simulation cost by using a planar neighbor search.

The Node test suite covers phase placement from ambient temperature, solid subdivision behavior, deterministic combustion products and mass preservation, mixing and emergent identities, thermal behavior, 2D/3D grid behavior, box bounds, Inspector sampling, graphics settings, erasing and gesture math. `npm run e2e` is a dependency-free app-shell smoke test. Full Android touch/gyro/FPS validation still requires a real browser/device pass.

## Deployment

Vercel builds with `npm run build` and serves `dist/`. GitHub remains the source of truth; active development stays on `feature/procedural-fluid-sandbox-mvp` until browser/mobile QA is complete.


