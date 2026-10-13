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
| Persistence | `src/game/persistence.mjs` | Version 3 schema, v1/v2 migration, validation, backup and future-save protection |
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

Flame and frost supply a finite energy rate to the lower copper bowl. Only
particles touching its upward-facing lower surfaces exchange that energy.
CauldronThermal tracks finite floor/lid heat reservoirs and conducts heat through
the copper; ThermalSolver synchronously exchanges energy between immediate
particle neighbours, with capacity weighting and a stable shared-contact budget.
Newly warmed neighbours affect their own neighbours on the next thermal tick.
Temperature changes by energy divided by particle mass and heat capacity. Heating also changes the
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
Steam buoyancy compares each reagent's intrinsic vapour density with a fixed
empty-atmosphere reference (`ROOM_DENSITY = 1`). Crowding under the lid never
removes lift; lighter vapour still rises more strongly. Liquid stratification
continues to use the separate reagent densities, and sandbox defaults are intact.

Vapour is retained and continues to reserve capacity. The lid exchanges heat
locally in either direction and warms with the pot, rather than remaining at room
temperature. Crowding does not create artificial cooling. Passive ambient
exchange is disabled while a source is running, so a continuously powered pot
can become uniformly hot/cold; above a
fluid's boiling threshold a hot lid cannot keep recondensing that fluid. With the
sources off, both copper and contents gradually approach `ROOM_TEMPERATURE = .33`
(33 °A), cooling hot brews and warming cold ones without source energy charges.
Empty copper also approaches room temperature. Frost removes energy at the same
bottom contacts and accelerates cooling through the existing neighbour network.
GasDensitySolver estimates local vapour concentration from parcel mass after
vessel collisions, using a smooth distance kernel over the support area. Parcel
refinement and fractional drains cannot invent concentration. The hysteretic
PhaseSolver converts only sufficiently cool, saturated gas patches back to
liquid over time; saturation falls with temperature, letting even dilute remnants
eventually condense as the pot cools. Hot gas never condenses from density alone. Condensation
droplets are rendered only for actual local gas-to-liquid progress. Bottling waits while more than .01 ml remains as
steam. The HUD shows trapped steam and the needed cooling action. Newly evaporated
ingredients are never removed; legacy evaporation history remains in old saves.

Dragging a spoon supplies nearby liquid with the drag's coherent velocity. Fast
and slow circles, reversal and duration change local movement and contact rates.
Holding Stir supplies the same physical impulse through a circular path for
players who prefer an accessible control. It never directly adjusts homogeneity.

MixtureSolver transports conserved colour/property fluxes between touching
neighbours using a previous-frame property field. A pigment front advances at
most one contact per transport tick; separating regions stops diffusion, even
when their material IDs or saved mixture group match. Degree normalization keeps
local transport bounded. Spoon work and warmth accelerate it. Each parcel retains
its measured source amount in ml, so unequal-density ingredients still converge
to their original measured proportions after full mixing. Partial drains scale
that amount alongside mass. Source-family minimum/maximum affinity envelopes
exclude incompatible additions. Legacy batch targets remain saved metadata and
do not drive relaxation. Reaction consumption remains in the live state.
Combustion likewise shares heat only with immediate neighbours, with ignition
reading a temperature snapshot to prevent particle-order-dependent instant chains.

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
follow screen density up to 768×464 in Crisp mode, or 384×232 in battery
mode, and use crisp scaling. Matter uses a reusable RGBA
layer with one-pixel texels and one canvas upload/draw per frame, including gas,
frozen solids and independently shaded sand grains. Original portraits, bottles, icons,
wood, stone, glass and copper share the same palette and pixel scale. There are
no stock assets, external fonts or emoji controls.

The game starts with a 200 ml budget and unlocks 320 and 440 ml cauldrons. A maximum
2,304-particle allocation leaves headroom above a full 1,760-particle large cauldron
for solver-generated products. Game-only contact radii and grid cells are scaled
to the finer packing; sandbox settings retain their existing defaults. It uses a
40 Hz fixed collision/phase step and at most three catch-up steps. Local
transport runs at 10–20 Hz for large bowls with full elapsed-time integration;
thermal and chemical passes are staggered. Radius/viscosity caches, distance
filtering before neighbour callbacks, smaller grid cells and a neutral-charge
fast path reduce CPU work. The renderer uses
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


### Contact tools and phase pacing

The spoon applies velocity only to liquid parcels touching its swept 0.42-unit head (plus the parcel radius). Neighbour viscosity transfers that motion gradually. The Pestle button selects a local 0.18-unit crushing head: touched coherent solids lose their body membership and become granular powder, retaining mass, temperature and chemistry. Powder subdivision survives save/restore. Freezing sets liquid parcels to coherent solid and welds touching freeze fronts; it preserves their compact offsets instead of snapping fine parcels onto the sandbox's coarse crystal lattice.

Shop evaporation and combustion run at 22% of the base transition rate; combustion heat is reduced to 30%. Condensation and melting retain their rates. Soft gas contact pressure and deterministic thermal agitation prevent vapor from forming a perfectly flat line beneath the sealed lid. Local concentration still controls cool condensation and material density still controls buoyancy. Every actively burning parcel renders a tiny warm light and bright core; completed reaction sparks are also particle-sized.

### Powder, solvent and compact block mechanics

Frozen coherent bodies use exact relative offsets and collide with the bowl as a whole. Crushing removes body membership and creates dry grain content; dry grains use near-full contact separation, normal damping, and tangential friction rather than liquid viscosity. Spoon contact radius is 0.42 units plus parcel radius, and it affects liquid, dough and powder without directly dragging coherent blocks.

Density sorting acts only on inverted contacts: an already ordered heavy/light interface receives no separating impulse. Its range fades at the local fluid-neighbour radius. Granular support and wall friction use mass-scaled contact radii instead of a fixed support distance, so fine grains cannot rest above an air gap. The laboratory draws full pixel footprints with colour flecks for grain texture at both resolutions.

Worlds start with six liquids and two dry powder jars (IDs 10–11); guild reagent IDs 7–9 keep their unlocks. Powders share the existing affinity, dough, dissolution, stirring, heating and inventory rules. Their measured bulk quantities use the same ml capacity units. The rack labels powders and uses an Add action. Save version 3 appends missing powders and 240 ml stock to v1/v2 shops once, preserving pinned ingredients, order targets and particle snapshots. Generated customer witnesses continue to use liquid recipes until powder-and-solvent witnesses are supported.

Powder content is a conserved local dry-material mass fraction. Compatible
condensed contacts exchange it only with recent local spoon work, independently
of falling or convection velocity. Gradual kneading changes hydrated grains to
Phase.LIQUID and uses the solvent's melting threshold, so room-temperature dough
does not immediately refreeze. Dough uses strongly dissipative liquid shear and
no granular support, rigid links or elastic bonds. Its measured viscosity reads
the same concentration-dependent rheology as the solver. Extra stirred solvent
smoothly removes the dough contribution below 12% dry content. Freeze/melt cycles
preserve that dry mass fraction. Gas never supplies liquid solvent.

A shop packing scale of 0.6 makes actual grain footprints finer without increasing
particle count. Radius uses mass/baseDensity (represented volume) in the shop;
thus equally measured portions of different densities have comparable parcel
sizes. Partial bottling shrinks parcels while preserving mass and stock quantities.
Generic sandbox packing keeps its original defaults. Resting sand uses about a
33-degree friction angle with a small static breakaway margin and revalidates support every step. Small contact skin
tolerances keep the fine pile static; deep overlap, missing support and spoon
motion remain mobile. There are no rigid connections between dry grains.

Powder fraction, kneading progress and solvent melting threshold survive saves.
Spontaneous stirring activity and cached resting flags are never restored.
