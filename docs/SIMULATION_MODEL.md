# Simulation Model

Fluid Pocket is a particle-based approximate physical sandbox, not a scientific CFD solver.

## Liquid

Liquid particles receive gravity, viscosity-dependent velocity damping, wall collisions and local distance constraints. Neighbor particles closer than a rest distance are separated; particles just outside it receive a small cohesion pull. These corrections approximate incompressibility and surface cohesion cheaply enough for a mobile browser.

## Gas

Gas skips liquid incompressibility. It receives weak spreading and local density estimation from gas neighbors. Buoyancy is opposite normalized gravity and scales with `environmentDensity - localGasDensity`. Dense gas neighborhoods can activate cooling.

The shop uses a fixed empty-atmosphere reference density of 1 and each reagent's
intrinsic vapour density for buoyancy. Local concentration cannot stop its rise.
Liquid density differences continue to drive incompatible-fluid stratification.
The shop estimates local vapour concentration from parcel mass with a continuous
distance kernel over the neighbourhood's area, after wall/lid collisions, without
sampling pairs. Fractional parcels and save refinement preserve concentration.
Cool patches condense progressively once concentration exceeds a saturation
threshold, which decreases toward zero at room temperature. Gas above its boiling
threshold never condenses from crowding alone. These are normalized game rules,
not a calibrated pressure or vapour-equilibrium model; sandbox rules are unchanged.

## Solid

Solid particles are strongly velocity-damped and use tighter structural attraction around a rest distance. They are semirigid clusters rather than rigid bodies. Phase transition to liquid removes that structural behavior.

## Thermal chain

Pair conduction is heat-capacity-weighted approximately. Gas concentration above a threshold adds a cooling term. Phase hysteresis suppresses numerical chatter. Density is recomputed when phase changes, so buoyancy/falling behavior changes causally with phase.

In the shop, density does not create cooling. Flame/Frost heat the finite bottom
copper reservoir, which exchanges heat with touching particles; neighbours and
the copper lid transport heat locally. With both sources off, copper and contents
relax exponentially toward the explicit room reference (.33, shown as 33 °A),
warming cold brews and cooling hot ones without a sudden temperature reset. Empty
copper also cools. Passive exchange does not add energy costs or source history.

Native cauldron phase fronts use fixed parcel nucleation offsets. Melting,
freezing, boiling and condensation crossfade their optical weights and colours;
cancelled transitions fade back before work begins toward an opposite phase.
The saved transition direction prevents boiling progress becoming freezing
progress after a heat reversal. Older saves infer their missing direction.

After a native phase handoff or reload, pressure overlaps relax over bounded
sub-parcel position corrections. Native contacts can dissipate input motion but
cannot amplify its speed beyond the incoming gravity/tool budget while this
relaxation is active. Coherent bodies relax at their centre, preserving their
shape. Relaxation continues while contacts still require correction; it does
not move parcels to arbitrary free slots or change their mass or recipe.

GPU and Canvas liquid contours share a kernel calibrated to LiquidFun's actual
particle/body contact distance. The solid substrate remains beneath intact
ingredient artwork, so sprite transparency does not expose a dark moat around
touching matter. Native liquid radius follows partially bottled volumes.

## Stability

All major scalar ranges are clamped. Velocity has a hard maximum. Walls clamp particle positions. Reactions have maximum per-step interpolation. Phase changes require progress and hysteresis. A final sanitization pass replaces non-finite values and reclamps the domain.
