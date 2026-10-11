# Mobile Performance

The renderer uses raw WebGL `POINTS` for matter plus a small pooled reaction-effects point cloud. No particle is an independent mesh.

The simulation uses typed SoA buffers, integer grid linked lists and fixed capacity. There is no global O(N²) neighbor search. The hot update loop avoids per-particle object creation. Reaction events are stored in fixed TypedArrays.

Simulation runs at 40 Hz with a fixed timestep; render runs at display cadence. LOW/MEDIUM/HIGH map to 1/2/3 position-relaxation iterations and different visual budgets. Automatic quality observes smoothed frame time and can drop from MEDIUM/HIGH to LOW without deleting matter.

The storage ceiling is 1,800 particles. The initial demo targets roughly 420–450 particles because the current CPU solver benchmark rises sharply past ~500 particles. HIGH is therefore experimental on mid-range phones. Future optimization should merge neighbor traversals for fluid/thermal/reaction work, move selected grid reductions to a worker, and consider WebGL2/WebGPU compute-like paths only if device coverage justifies them.
