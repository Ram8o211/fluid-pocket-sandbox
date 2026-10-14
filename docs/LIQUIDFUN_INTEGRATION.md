# Google LiquidFun integration

This project vendors the **official Google LiquidFun 1.1.0 JavaScript build** from [google/liquidfun](https://github.com/google/liquidfun/tree/master/liquidfun/Box2D/lfjs), with the upstream redistribution notice in `public/vendor/LIQUIDFUN-LICENSE.txt`. The 630 KB engine is self-hosted and cached, so the shop remains usable offline on GitHub Pages. Its code is not a lookalike physics implementation.

## Design

- `index.html` loads Google's compiled `public/vendor/liquidfun.js` before the game module.
- `src/game/LiquidFunFluid.mjs` creates a real `b2World`, static `b2EdgeShape` fixtures following the sealed cauldron, and a `b2ParticleSystem`. Only liquid particles are registered with LiquidFun; the bridge copies current positions and velocities into its native buffers, steps the actual physics engine, and copies back resulting coordinates and momentum.
- `SimulationEngine` runs legacy contact logic for gas, powder and cohesive solids, but **skips legacy liquid-liquid fluid integration and solves**, which are delegated to LiquidFun. The engine's subsequent heating, local phase changes, buoyancy, density calculations, chemical/magical contact reactions, arcane awakening, and combustion continue to act on the original particle arrays without being reimplemented.
- Every particle retains its material ID, mass, magical channels, arcane threshold, thermal parameters, miscibility, and group provenance in the game. LiquidFun handles no potion properties beyond liquid motion. All saved materials and vial contents retain the same schema.
- LiquidFun's internal particle mappings are rebuilt only when the active liquid indices change due to pouring, condensation, freezing, combustion or bottling. Positional/velocity buffers otherwise remain stable through frames.
- The standalone freeform `sandbox.html` and Node-only tests retain the old 3D solver. This first integration is specifically for the 2D alchemy cauldron.

## Validation

`tests/liquidfun-bridge.test.mjs` covers phase-selective motion and invariance of magic, heat, mass, material identity, and arcane thresholds. `scripts/browser-test.mjs` checks that the **actual upstream global `b2World`** loaded and the brewing session selected the LiquidFun backend. The GitHub Pages workflow runs complete mobile/browser gameplay tests before and after deploying.

## Limits

The old gas and powder simulations remain custom, as requested for sandy/dough-like behavior; rebuilding every non-fluid subsystem as Box2D rigid bodies is outside this fluid-physics integration. LiquidFun's native particle radius, damping and pressure were tuned for the game's small 2D sealed vessel; further mobile stress benchmarks may warrant retuning.
