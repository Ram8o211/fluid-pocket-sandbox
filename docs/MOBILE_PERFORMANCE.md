# Mobile performance

The shop retains 2,304 fixed particle slots for saved-game compatibility, but
new batches use **two parcels per ml** (0.5 ml each): a full upgraded 440 ml
cauldron now contains **880 particles instead of 1,760**. Native LiquidFun
radii and game particle footprints scale with represented liquid mass. Thus
liquid coverage, volume, motion and potion effects remain mass-conserving while
pair contacts and per-particle rendering work decrease. Existing .25 ml saves
load unchanged, and new pours in them use compact parcels. The original sandbox
retains its separate defaults and graphics presets.

Physics collisions, gravity, phase progress and spoon response run at 40 Hz.
Large bowls integrate local heat and composition transport at 10–20 Hz using the
full elapsed time. Heat and chemistry run on staggered ticks. Dynamic and swept
sand contacts are never skipped by generic pair decimation; supported, stationary
grain pairs avoid redundant collision work after their supports are revalidated.

The hot paths use typed buffers, cached radii/viscosity, actual-distance filtering
before neighbour callbacks and contact-sized granular queries. Uniform thermal
fields and neutral charge fields avoid unnecessary pair passes. Spatial-grid heads
allocate on demand instead of reserving the maximum 3D lattice: a shop now uses
about 5.7 KB for its grid heads rather than about 6 MB. Granular angle scratch and
transport buffers are reused.

Matter paints into one reusable RGBA layer and uses a single canvas upload/draw
per frame, replacing many per-texel drawing calls and colour strings. Crisp mode
follows screen density up to 768×464; battery mode uses 384×232 at 30 FPS. Material
texels are always one pixel and actual shop particle footprints are finer. This
changes neither stock quantities nor measured ingredient mass. Native resolution
prevents redundant supersampling on ordinary desktop displays.

Magical and chemical concentrations remain typed particle channels transported
in the same conservative local passes as physical properties. Resource regrowth
and experimental subject responses run on demand. Magic rendering reuses six
cached 20×20 light sprites and fixed scratch buffers, with at most 160 halos per
frame or 48 in battery saver. Adaptive `effectsScale` reduces count and alpha;
zero disables both halos and foreground shimmer.

`npm run benchmark:game` measures ground-herb infusions, sand and kneaded
powder/liquid scenarios
at 60, 200 and 440 ml, including periodic real inspection. It reports median and
p95 CPU time per 40 Hz step; a step's nominal budget is 25 ms. Benchmark numbers
are runner measurements rather than guarantees of Android FPS. Browser acceptance
covers both graphics modes, real gestures, two complete sales, phase transitions,
raw grinding, stirring-only liquid dough, experiment dosing, resource depletion,
separate infinite sandbox saves and restoration under a GitHub Pages project path.

The cauldron now uses 0.18-unit broad-phase cells to match its compact contact
lengths. Spatial queries cache their forward cell stencil and pass live pair
geometry directly to the fluid, heat, gas-density and reaction solvers. Search
radii, pair-stride schedules, full contact coverage and the sandbox's larger 3D
cells remain unchanged. Uniform, single-source batches with no mixing history
skip chemistry contact scans after source accounting; field, group or hydration
differences wake transport on the next scheduled chemistry tick.

LiquidFun appends a pure pour's new particle tail without rebuilding the pool.
Removal, reordered membership and phase substitutions still rebuild the mapping,
and real native buffer lengths are checked before and after stepping. Solid
membership arrays and numeric radii/densities are reused; unchanged native body
motion avoids redundant handoffs. Exact Float32 comparisons preserve small real
tool impulses, and pressure-limited readback forces a handoff on the next tick.
Native solid-only bowls skip the duplicate legacy contact pass. Frozen-component
scratch is retained per particle system, and WebGL uploads active instance ranges
without new typed-array views or clears of unused phase targets.

Slowly transported solid properties retain native contacts until radius drift
exceeds 0.5% or density drift exceeds 1% of the actual fixture, with numerical
floors of 0.00001 units and 0.0001 density respectively. The cache compares
against fixture creation values, so drift cannot accumulate across ticks. The
radius allowance is below 0.02 native display pixels. Any quantity change,
membership change, crushing or phase handoff updates the collider immediately;
the authoritative material, mass, colour and magical channels update every tick.

`npm run benchmark:fluids -- --json` benchmarks the real vendored LiquidFun
runtime in the same JavaScript realm as the adapter, with water, infusions, sand,
dough, ice, vapour and a moving continuous pour at 120/440 ml. It warms each
scenario, reports median/p95 CPU step times, and checks finite motion and mass.
Pouring also reports native rebuilds/appends and the actual emitted quantity.
Use `--fallback` for the JavaScript engine or `--case=Pouring` for one scenario.
Compare revisions sequentially on the same idle runner; these are CPU timings,
not a device FPS guarantee or GPU execution measurement.
