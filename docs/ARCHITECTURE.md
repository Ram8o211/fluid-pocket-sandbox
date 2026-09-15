# Architecture

The project is split so the simulation has no dependency on Three.js or the DOM. `SimulationEngine` owns particle state, a spatial grid, independent physics solvers and the local reaction engine. Rendering reads simulation buffers but never writes physical state. Input/sensors write only the global gravity vector or explicit sandbox tools.

## Data flow

`GravityInputProvider → SimulationEngine → FluidSolver → SpatialGrid rebuild → Buoyancy/Thermal/Phase solvers → ReactionEngine → sanitization → renderer`.

The fixed simulation step is 1/40 s. Rendering is independent. Particle data uses Struct-of-Arrays typed buffers to improve locality and avoid object churn in the hot loop. Spatial lookup uses a dense grid of integer head pointers with a per-particle linked-list `next` buffer.

## Ownership

- `ParticleSystem`: capacity, allocation and physical property arrays.
- `SpatialGrid`: neighbor indexing only.
- `FluidSolver`: position relaxation, cohesion, viscosity damping, gas spreading, solid cluster constraints and walls.
- `ThermalSolver`: ambient coupling and pair conduction.
- `PhaseSolver`: hysteretic gradual transitions.
- `BuoyancySolver`: gas acceleration and condensation-cooling helper.
- `ReactionEngine`: only cross-material contact reactions.
- `SceneRenderer`: raw WebGL GPU point rendering, box lines/floor, gravity indicator and pooled transient reaction effects.

The separation is intentional: a phase change modifies the solver behavior on the next step, while reactions can modify local density/viscosity/temperature and therefore trigger downstream rules.
