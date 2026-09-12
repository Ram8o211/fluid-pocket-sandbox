# Fluid Pocket Sandbox

Fluid Pocket Sandbox is a mobile-first 3D procedural-matter sandbox designed for Chrome on Android. The phone acts conceptually as the container: changing the gravity vector with device orientation (or a touch fallback) changes how liquids, gases, and particle-cluster solids move inside a transparent box.

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

Open `http://localhost:4173`. The runtime itself has no npm/browser framework dependency; The MVP renderer is a zero-dependency raw WebGL point renderer; Three.js was deliberately omitted to remove first-load CDN/network cost and make the PWA self-contained. The static build is emitted to `dist/` and `vercel.json` points Vercel at that directory.

## Core architecture

- `src/simulation/`: SoA particle storage, dense spatial grid, fluid/solid/gas motion, thermal exchange, buoyancy, phase transitions.
- `src/materials/`: material definitions, deterministic seeded generation, demo presets.
- `src/reactions/`: contact-gated mixing, property-distance intensity, reaction-potential and thermal-shock responses.
- `src/sensors/`: manual, device-orientation, and test gravity providers.
- `src/rendering/`: one WebGL `POINTS` draw path plus transparent box, gravity arrow, and pooled reaction flashes.
- `src/performance/`: adaptive quality controller.
- `src/app/`: orchestration, save/export/import, touch tools.

The hot particle state is stored in parallel `Float32Array`/`Int32Array` buffers. The grid stores per-cell linked lists, avoiding global O(N²) neighbor search.

## Simulation model

Liquids use a low-cost position-relaxation solver inspired by position-based fluids / double-density relaxation rather than Navier–Stokes. It provides qualitative volume preservation, cohesion, viscosity damping, splashing, box collisions and density ordering.

Gas particles are sparse. Local gas density is derived from neighboring gas particles in grid cells. Light gas receives acceleration opposite gravity. When local gas density exceeds the condensation threshold, a configurable cooling term lowers temperature and can move particles below the condensation threshold.

Solids use strongly damped, cohesive particle clusters. Melting progressively removes the solid phase behavior by transitioning particles to liquid.

## Material properties

All values use abstract simulation units. Each material has color, opacity, base density, viscosity, cohesion/surface tension, miscibility, temperature, heat capacity, conductivity, melting and boiling thresholds, hysteresis, volatility, reaction potential, and gas compressibility.

Particles copy those properties locally when emitted. This matters: mixing changes only particles that actually touch instead of mutating a global material definition and causing remote transformations.

## Mixing and reactions

For two touching particles:

- `ΔM = |miscibilityA - miscibilityB|` gates mixing.
- Compatibility increases as `ΔM → 0`.
- Reaction rate is `baseMixingRate * compatibility^p * contactFactor`.
- Visual/impulse intensity also depends on normalized property distance.
- Local particle properties converge toward a mass-weighted mean.
- Strongly opposite abstract reaction potentials dissipate into heat and impulse.
- Large temperature differences generate thermal-shock turbulence.

See `docs/REACTION_SYSTEM.md`.

## Phase transitions

Transitions use hysteresis and progress rather than instantaneous toggles:

- solid → liquid above melting + hysteresis;
- liquid → solid below melting − hysteresis;
- liquid → gas above boiling + hysteresis;
- gas → liquid below boiling − hysteresis.

The `RAIN CYCLE` preset is configured to demonstrate boiling, buoyancy, gas accumulation, concentration-driven cooling, condensation, and falling liquid.

## Controls

- `MATERIAL`: create/randomize materials, edit physical properties, pour, heat and cool.
- `BOX`: resize the container from 3–12 simulation units on each axis.
- `RULES`: tune mixing, condensation and thermal coupling.
- `ENV`: tune environment density, ambient temperature, gravity and sensor sensitivity; enable/calibrate motion controls or drag the manual gravity pad.
- `DEBUG`: live phase/reaction/grid statistics, visual debug modes, quality override, setup export/import.

Touch the viewport in Pour/Heat/Cool modes. Camera mode uses one-finger orbit. `Camera` resets the view.

## Device orientation

`DeviceOrientationProvider` performs feature detection, requests iOS-style permission only from a user gesture, supports calibration and low-pass filtering, clamps noisy input, and can always be replaced by `ManualGravityProvider`. Tests use `TestGravityProvider`; no physical sensor is required.

## Performance

The simulation runs at a fixed 40 Hz while rendering follows `requestAnimationFrame`. LOW/MEDIUM/HIGH alter solver iterations/effect budgets; automatic quality drops the solver to LOW when sustained frame time is high. The default demonstration uses roughly 420–450 particles. HIGH allows up to the 1,800-particle storage budget but is not expected to be suitable for every phone.

Run `npm run benchmark` for non-gating CPU metrics. Node benchmark numbers are useful for regressions, not direct mobile FPS predictions.

## PWA and persistence

A minimal manifest and service worker cache the application shell and subsequently fetched static/module assets. Setup definitions, rules and box/environment settings are saved locally. JSON export/import supports sharing setups. Full live-particle state persistence is not part of this MVP.

## Tests

The Node test suite covers deterministic generation, miscibility gating, rate monotonicity, mass-weighted means, visual intensity, hysteresis and all four main phase changes, buoyancy direction, condensation cooling, stratification, grid neighbors, box clamp, finite-value stress behavior, and the boil → gas → buoyancy → cooling → condensation causal chain.

`npm run e2e` is a dependency-free app-shell smoke test. `e2e/mobile.spec.mjs` documents the Playwright mobile flow intended for a browser-enabled CI/QA environment.

## Deployment

Vercel should build with `npm run build` and serve `dist/`. GitHub is intended to remain the source of truth; development should occur on `feature/procedural-fluid-sandbox-mvp` before any merge to `main`.

## Known MVP limitations

This is not quantitatively calibrated physics. Surface reconstruction, true pressure solves, rigid-body solids, latent heat, real thermodynamics/chemistry and fully conservative energy integration are deliberately out of scope. The solver prioritizes causal legibility, stability and mobile cost. The runtime has no external browser dependency and can be cached entirely by the service worker after first application load.
