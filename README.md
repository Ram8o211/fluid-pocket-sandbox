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
