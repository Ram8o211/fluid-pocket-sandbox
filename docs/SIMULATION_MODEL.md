# Simulation Model

Fluid Pocket is a particle-based approximate physical sandbox, not a scientific CFD solver.

## Liquid

Liquid particles receive gravity, viscosity-dependent velocity damping, wall collisions and local distance constraints. Neighbor particles closer than a rest distance are separated; particles just outside it receive a small cohesion pull. These corrections approximate incompressibility and surface cohesion cheaply enough for a mobile browser.

## Gas

Gas skips liquid incompressibility. It receives weak spreading and local density estimation from gas neighbors. Buoyancy is opposite normalized gravity and scales with `environmentDensity - localGasDensity`. Dense gas neighborhoods can activate cooling.

## Solid

Solid particles are strongly velocity-damped and use tighter structural attraction around a rest distance. They are semirigid clusters rather than rigid bodies. Phase transition to liquid removes that structural behavior.

## Thermal chain

Pair conduction is heat-capacity-weighted approximately. Gas concentration above a threshold adds a cooling term. Phase hysteresis suppresses numerical chatter. Density is recomputed when phase changes, so buoyancy/falling behavior changes causally with phase.

## Stability

All major scalar ranges are clamped. Velocity has a hard maximum. Walls clamp particle positions. Reactions have maximum per-step interpolation. Phase changes require progress and hysteresis. A final sanitization pass replaces non-finite values and reclamps the domain.
