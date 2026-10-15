# The Alchemist’s Shop

## Pixel-toon workshop and recovered reagents (Build 37)

The menu, workbench, garden, guild, notebooks and original physics room share a crisp pixel interface, an original local display font, outlined controls and a brighter illustrated palette. Rabbit anatomy uses a single clean silhouette with flat fur shading; persistent potion changes still grow in place.

Rabbits wander between seeded waypoints in short hops, land, sniff and graze inside the fence. They keep personal space and remain selectable with touch. Dead rabbits stop all movement and sprite animation. An unrecovered body in the isolation cage must be cleared before another rabbit can enter.

Select a dead rabbit and choose **Recover ingredients**. Ordinary adults yield four Rabbit Bone and three Moon Fur measures; charred bodies yield four Cinder Ash measures, dissolved bodies yield two ml of Strange Ichor. Corrosion reduces usable bone and removes fur, while altered or poisoned remains can also yield ichor. Babies yield smaller harvests. Each body can be recovered once; its trial history stays available. Recovered ingredients have known, weak native magic, work with the same crushing, mixing and arcane activation rules, and join an existing brew without resetting it. They cannot be bought or grown in the garden. Stock and recovery state survive saves and reloads.

`node --test tests/rabbit-recovery-motion.test.mjs` covers recovery, exact stock transfers, old saves, brewing, cage occupancy and stationary corpses. Browser acceptance also checks the recovery controls and mobile layouts. The checked-in font can be rebuilt with `python scripts/pixel-font.py` when Python fonttools is installed; the game itself needs no font dependency or download.


A mobile fantasy potion shop running entirely in the browser, built on the
existing 2D particle engine.

**Play:** https://ram8o211.github.io/fluid-pocket-sandbox/

Customers describe problems that require magical effects. Start with plain
water, garden plants, crushable enchanted stones and three magical liquids.
The known ingredient enchantments contribute according to their proportions;
grinding, stirring, extraction and preparation determine the liquid you bottle.
Physical parameters stay inside the simulation, outside the shop’s descriptions.

The personal garden provides small timed harvests, limited stamina and bounded
regrowth while you are away. Tending costs water. Village parcels are expensive
and have shipment cooldowns. Sandbox mode provides infinite ingredients and
saves separately.

Rabbit trials consume real 2, 5 or 10 ml doses. Start with four adults in a fenced
colony; select an individual, move it into the isolation cage, administer a dose,
or return it to the pen. Effects accumulate permanently: muscle growth, acid
erosion, scorched fur, frost, illness and seeded anatomical mutations have distinct
visible stages. Severe exposure can kill a rabbit. Love speeds breeding, while
an overdose or a transformed creature can endanger the pen; the cull tool acts
immediately. Babies grow into adults and tolerate much less potion. Buy distinct
adults to replace lost stock, up to twelve living rabbits.

Compare the before-dose reference, replay or pause the scene, and **write your
own potion ID** with eight estimated enchantment values. Trials and the recipe
book preserve observations without revealing an automatic assay. Buying a new
rabbit preserves every existing animal’s injuries and the trial history.

Use **Pour back** in the vial or trial room to return the unconsumed potion to
the cauldron. Its magic, temperature, expenses and ingredient proportions travel
with it, including irreversible awakening and heat damage. Adjust the brew and
test it again: reopening invalidates the previous ID, seal and price offer.
Consumed doses stay consumed. A full pot rejects the transfer without losing it.

Bottle and bargain with the customer through offers and counteroffers. Payment
follows the agreement, while effectiveness is discovered after delivery.
Disappointed customers may return later for mandatory refunds, including when
you have insufficient cash (the balance becomes guild debt). Some buyers bluff.
An expensive expert seal for that exact batch defeats a false claim; real faults
still require refunds. Receipts, appointments, claims and IDs survive reloads.

Gentle warmth allows otherwise separate essences to mix. Overheating permanently
weakens magic. Every ingredient has an independent awakening threshold, usually
beyond the apparatus’s range. Opposed thresholds mix in proportion and can move
into reach. Sustained exposure awakens one dominant enchantment, suppressing the
others. This threshold is independent of melting and boiling.

The fitted lid retains vapour until it recondenses. Loose powders settle as
independent grains; stirring can turn wet powder into dough, then a thinner
infusion with more solvent. A wooden spoon, softly shaded continuous liquid
surfaces and rounded material footprints make local motion visible. Navigation,
beds, ingredients, receipts and ID forms use horizontal collections inside the
phone viewport. Saved shops migrate without replacing an active cauldron.

Cauldron liquids use the vendored Google LiquidFun engine with pressure steps
of at most 1/80 s (up to four steps for fast spoon strokes). Its collision
outline and parcel radius match the game's vessel contacts, including after
partial bottling and refilling. Vapour shares the swept spoon footprint and
local momentum transport; compressible pressure, temperature and material
buoyancy retain a steam layer beneath the sealed lid without elastic rebounds.

The workshop reconstructs liquid and vapour on WebGL2 from batched particle
instances. Two vessel-sized half-float density/colour fields keep touching
liquids continuous and steam translucent; grains retain their texture. Colours
and magical light come from each live parcel. Balanced fields are 192×100,
independent of screen DPR, and eco fields are 98×52. A liquid pool takes two
draw calls, liquid plus vapour four, and an added granular batch one more.
Unsupported devices and lost GPU contexts use the Canvas2D fallback; restored
contexts resume WebGL2. Replacing a shop releases its GPU resources.

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
npm run test:liquidfun
npm run test:fluids:browser
npm run benchmark:game
```

Browser acceptance drives visible controls for two negotiated commissions,
creature trials, manually entered IDs, a timed harvest, reload persistence,
magical liquids and both sandbox modes. It checks 320×568, 360×640, 393×852 and
desktop layouts. `SITE_URL` runs the same acceptance against a live deployment;
`BROWSER_PATH` selects an installed Chromium. Screenshots stay in ignored
`test-results/`. Unit regressions cover phases, transport, powder/dough, quantity
conservation, awakening, heat damage, bargaining, seals and offline refunds.

See [magical gameplay](docs/MAGICAL_GAMEPLAY.md) for the new contracts and
[simulation model](docs/SIMULATION_MODEL.md) for the underlying engine. The game
has no runtime package downloads, server, cloud sync or native APK. Benchmarks
measure the current runner; physical phone profiling is still separate work.

**Original sandbox:** https://ram8o211.github.io/fluid-pocket-sandbox/sandbox.html?mode=2D

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


# Effect commissions and experimental discoveries

Customers request one or more potion effects, with limits on unwanted effects. The first commission already requires strength; neutral water cannot fulfil an effect request. Better concentration matches earn larger offers. Orders are validated against an attainable preparation using unlocked ingredients, but customer dialogue and clues never reveal that recipe. Older in-progress commissions are preserved when continuing an existing save.

The effects of plain ingredients are visible on the rack and in Ingredients from the start. A mixture starts unknown. Inspecting it, bottling it, buying the Arcane prism, or saving an untested formula does not reveal its effects or its expected offer. Consume a real dose in the Experiments room to observe effects, compare them with the request, and decide whether to adjust and retest. Physical instruments still provide preparation clues.

Experiment records retain the observed sample and its full preparation. Named recipes distinguish tested discoveries from untested hypotheses; previous trials are also available in the recipe book. Testing knowledge follows the batch through bottling, smaller sealed quantities, and save/restore. New ingredients, material changes, or meaningful temperature changes invalidate the current reading. A fresh preparation requires a fresh trial even when it follows a learned recipe. A modern effect commission can only be served after a valid test of that batch; its offer remains unknown until then.

