# Mobile performance

The shop uses 2,304 fixed particle slots. Four parcels represent each ml, so a
full upgraded 440 ml cauldron contains 1,760 particles. The original sandbox
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
