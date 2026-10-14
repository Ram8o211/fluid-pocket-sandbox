# Google LiquidFun integration

This project vendors the **official Google LiquidFun 1.1.0 JavaScript build** from [google/liquidfun](https://github.com/google/liquidfun/blob/gh-pages/testbed/liquidfun.js), with the upstream redistribution notice in `public/vendor/LIQUIDFUN-LICENSE.txt`. The 630 KB engine is self-hosted and cached, so the shop remains usable offline on GitHub Pages. Its code is not a lookalike physics implementation.

## Design

- `index.html` loads Google's compiled `public/vendor/liquidfun.js` before the game module.
- `src/game/LiquidFunFluid.mjs` creates a real `b2World`, static `b2EdgeShape` fixtures following the sealed cauldron, and a `b2ParticleSystem`. Only liquid particles are registered with LiquidFun. An exact-count bulk particle group seeds the native buffers, then the bridge copies the game's positions and velocities before the first physics step. Native viscous and static-pressure flags give hydrostatic support and dissipative shear without tensile/surface-spring forces; no spring, elastic or native color-mixing flags are used.
- `SimulationEngine` delegates liquid integration and pressure/packing to LiquidFun. Native liquid motion and legacy gas/grain integration both complete **before** powder and solid contacts are resolved. Supplemental material-dependent viscosity (including temperature and wet dough) and immiscible density sorting use the live parcel fields, because the native particle system exposes one uniform density/viscosity setting. Heating, local phase changes, chemical/magical reactions, arcane awakening and combustion still act on the original arrays.
- Every particle retains its material ID, mass, magical channels, arcane threshold, thermal parameters, miscibility, and group provenance in the game. LiquidFun handles no potion properties beyond liquid motion. All saved materials and vial contents retain the same schema.
- LiquidFun's internal particle mappings are rebuilt only when the active liquid indices change due to pouring, condensation, freezing, combustion or bottling. Positional/velocity buffers otherwise remain stable through frames.
- Partial bottling drains a representative fraction from every parcel, leaving the same indices with less volume. The native radius scales by the square root of mean remaining parcel area, so the physical fluid contracts too. Exact-position liquid/grain overlaps recover the incoming contact normal instead of skipping the collision.
- Private customer witness trials release their native worlds in `finally`; switching shops also disposes the previous session. Disposal frees the C++ world and the upstream wrapper's two per-world scratch buffers.
- Cauldron wall contacts have zero restitution, and settled water uses stronger native velocity damping rather than surface-tension spring impulses. A poured or spoon-driven stream continues to flow under real gravity; no per-particle motion is artificially injected at rest.
- The standalone freeform `sandbox.html` and Node-only tests retain the old 3D solver. This first integration is specifically for the 2D alchemy cauldron.

## Validation

`tests/liquidfun-bridge.test.mjs` covers the bridge contract. `tests/liquidfun-native.test.mjs` executes the unmodified vendored engine in a Node VM and checks native parcel counts, settling, material viscosity/dough, inverted density layers, full pots, phase changes and disposal. `npm run test:liquidfun` exercises the actual browser runtime through full-pot stirring/freezing/melting/bottling/reload and repeated session disposal. CI and Pages run it alongside complete mobile gameplay tests, including on the published site.

## Upstream JavaScript binding defects

The shipped 1.1.0 scalar `CreateParticle` binding stores stack addresses in `group`/`userData` rather than null pointers. Reproduction with six individually allocated water particles leaves only three after the first native step, and some surviving parcels gain wall/zombie flags. Using the upstream **bulk shape/group** allocation path avoids this binding without modifying Google's engine.

The JS `GetParticleCount()` wrapper also multiplies the actual count by two. Position/velocity views and the raw `Module._b2ParticleSystem_GetParticleCount` export report the true count. The bridge checks that both views have exactly `2 × expected_count` floats before and after every step and never extends a short view into unrelated heap memory.

## Limits

The old gas and powder simulations remain custom, as requested for sandy/dough-like behavior; rebuilding every non-fluid subsystem as Box2D rigid bodies is outside this fluid-physics integration. LiquidFun's native particle radius, damping and pressure were tuned for the game's small 2D sealed vessel; further mobile stress benchmarks may warrant retuning.
