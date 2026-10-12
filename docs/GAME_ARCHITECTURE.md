# The Alchemist's Shop

The root page launches the mobile-first 2D potion shop. `sandbox.html` preserves
the original experimental 2D/3D application. No 3D renderer is imported by the
shop entry point, and no backend or production framework dependency is needed.

## Boundaries and contracts

| Layer | Owner | Responsibility |
|---|---|---|
| Physics | existing `src/simulation` and `src/reactions` | Particle state, momentum, fluid contact, thermal conduction, phases, electrical behavior, reactions and combustion |
| World | `src/game/world.mjs` | Seed hashing, original MaterialGenerator reuse, validated starter diversity, names and rare unlocks |
| Brew adapter | `src/game/brewing.mjs` | Cauldron walls, metered stock transfer, spoon impulses, thermal energy, sampling, exact liquid drain and full snapshots |
| Vessel geometry | `src/game/cauldron.mjs` | Shared collision planes and rendered cutaway, radius clearance, fine particle quantity and pool limits |
| Potion | `src/game/potion.mjs` | Mass-weighted MaterialSampler reuse and physical/derived measurement |
| Customers | `src/game/orders.mjs` | Seeded personalities and attainable targets from bounded actual engine brews |
| Assessment | `src/game/evaluation.mjs` | Pure weighted tolerance-aware scoring, hard constraints, quantity and pricing |
| Shop | `src/game/economy.mjs` | Stock, coins, costs, single-use sales, reputation, purchases, unlocks and discoveries |
| Persistence | `src/game/persistence.mjs` | Version 2 schema, v1 migration, validation, backup and future-save protection |
| Art | `src/game/art.mjs`, `LaboratoryRenderer.mjs` | Original pixel sprites, seeded portraits, workshop and existing planar rendering contract |
| Interaction | `src/game/main.mjs` | State transitions, touch/keyboard controls, tutorial, panels, sound and autosave |

`contracts.mjs` documents WorldSeed, Ingredient, PotionSample, Customer,
CustomerOrder, LaboratoryEquipment, ShopState and SaleResult. UI event handlers
never write particle buffers. The renderer reads them; `BrewingSession` is the
only gameplay writer. Domain modules and the existing physics have compiler
checks; UI modules have syntax lint and executable browser acceptance checks.

## Quantities and physical actions

The engine uses normalized material units, not calibrated real chemistry. The
guild labels temperature as °A. Each initially emitted particle represents .25
ml: its mass equals the ingredient's density times .25. Stock is debited only for particles
successfully emitted. Inventory, remaining capacity and allocated particle slots
bound a pour. Spatial and phase-dependent solvers continue to control the fluid.

Flame and frost distribute a finite energy rate through weighted local contacts.
Temperature changes by energy divided by particle mass and heat capacity; the
existing ThermalSolver then conducts that heat. Heating also changes the
effective viscosity used by FluidSolver and accelerates compatible liquid contact
mixing with a bounded temperature multiplier. PhaseSolver and CombustionSolver
continue to determine freezing, boiling and combustion. The copper lid seals all
phases inside the same convex cutaway used for rendering. Radius-aware collision
planes run during fluid integration and packing, after rigid contacts, and after
generated products. Clipping also contains particle rounding and reaction effects.

Shop liquids use downward gravity without the sandbox's point-charge repulsion.
Electrical conductivity and potential still drive charge exchange and alchemical
measurements. The game bounds velocity feedback from dense overlap corrections;
supporting contacts arrest falling liquid instead of launching it upward. This
lets small batches settle into a bottom pool and settle again after stirring.
Steam retains its existing buoyancy, and sandbox force/solver defaults are intact.

Vapour is retained, continues to reserve capacity, and cools gradually through the
lid. Frost accelerates that cooling; the existing hysteretic PhaseSolver converts
gas back to liquid over time. Bottling waits while more than .01 ml remains as
steam. The HUD shows trapped steam and the needed cooling action. Newly evaporated
ingredients are never removed; legacy evaporation history remains in old saves.

Dragging a spoon supplies nearby liquid with the drag's coherent velocity. Fast
and slow circles, reversal and duration change local movement and contact rates.
Holding Stir supplies the same physical impulse through a circular path for
players who prefer an accessible control. It never directly adjusts homogeneity.

Vials drain an exact representative mass fraction from every liquid particle.
They preserve heterogeneity, exclude gas/solid material, leave the remaining
mass in the cauldron, and cannot exceed available liquid. Fractional particle
mass is conserved across subsequent drains. Reaction-induced density changes
can change available volume, so customer validation supplies a small excess for
mixing trials and requires a full resulting vial.

## Derived properties and evaluation

Colour is the mass-weighted actual particle colour. Density is drained mass
divided by drained volume. Texture uses the same temperature-dependent viscosity
as the fluid solver. Volatility reads actual sampled particle properties.
Stability combines variance in colour, density and viscosity, mixing affinity
variance, and liquid phase fraction. Potency combines simulated reaction
potential, electrical conductivity and crystallinity, bounded exposure to actual
heat, and homogeneity. Fresh additions dilute activation by mass; emptying the
cauldron clears it. Neither potency nor stability has an independent game slider.

Customer generation performs a bounded three-second real-engine trial using
available ingredients and equipment. Targets are read from its bottle. A safe
ambient trial is used if a prospective brew freezes or still contains steam. Different
order indices and world seeds generate different requests; early requests have
two requirements and later ones gain thermal, stability and magical priorities.
The witness is feasibility evidence, not a recipe-matching scoring system.

Each property's error is compared with its tolerance. Inside tolerance, the
similarity falls gently from 1 to .9; beyond it, a continuous Gaussian tail
reduces the match. Weighted similarity is multiplied by delivered quantity,
liquid fraction, and a penalty for hard failures. Empty/tiny vials earn nothing.
Payment has a quality-dependent curve and a strict customer-budget ceiling.
Ingredient acquisition debits coins when restocked, not again when poured.
Profit separately accounts for the consumed stock value, energy and vial.
Each order can be sold once. Spare stock can be traded at a loss to raise cash;
rejected vials can be discarded to retry without a stock refund. Loans are restricted, outstanding debt blocks a
second loan, and repayments come from subsequent actual sales.

## State and saves

Menu → brewing → sealed inspection → sale → next customer. Inventory, measuring
bench, guild, settings and recipe book are modal panels; reading pauses the brew.
Stock persists when cleaning, changing screens or reloading. A sealed vial stays
sealed and cannot be modified to influence its assessment. Recipes store actual
portions and measurements; recalling one only pours ingredients through the
adapter, leaving heating and stirring to the player.

Autosave runs after important actions, every eight seconds while brewing, and on
visibility/page exit. Saves pin generated materials rather than relying on future
generator changes. They include active order, stock, progression, discoveries,
pending vial, full physical particle fields and brewing history. Restoring frozen
particles reconstructs rigid membership. Trapped steam and phase progress survive
reloads. Legacy one-ml particles are subdivided once without changing sampled mass,
colour, temperature, stock, costs or progression. Thermal controls restart off. A corrupt
primary save can recover a validated backup; future-version saves are preserved.
Export/import is available in Settings. The separate sandbox save key is intact.

## Rendering, performance and static hosting

The workshop reuses PlanarRenderer's projection, material colouring and reaction
effects. Pixel particles show real positions, colours and phases. Canvas targets
are 384×232 or 192×116 and use crisp scaling. Original portraits, bottles, icons,
wood, stone, glass and copper share the same palette and pixel scale. There are
no stock assets, external fonts or emoji controls.

The game starts with a 200 ml budget and unlocks 320 and 440 ml cauldrons. A maximum
2,304-particle allocation leaves headroom above a full 1,760-particle large cauldron
for solver-generated products. Game-only contact radii and grid cells are scaled
to the finer packing; sandbox settings retain their existing defaults. It uses a
40 Hz fixed physics step, at most three catch-up steps, existing solver scheduling,
30 FPS battery rendering and AdaptiveQuality-based resolution/effect fallback.
Rendering quality never changes stock quantities or assessment. Native Android
hardware measurements are still needed; CPU/browser emulation is not a device
performance guarantee.

All entries and assets use project-relative paths. `build` copies both modes into
`dist` with the same structure as source hosting. The service worker upgrades the
old cache and uses network-first HTML, scripts and styles. Browser acceptance
runs under `/fluid-pocket-sandbox/` to catch project-path mistakes. CI runs the
compiler, lint, all unit/integration tests, build/static smoke and a real portrait
browser. Pages repeats these checks and runs the complete browser flow against
the published URL after deployment, retaining screenshots as workflow artifacts.
