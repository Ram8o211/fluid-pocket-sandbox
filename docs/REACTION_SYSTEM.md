# Reaction System

Reactions require physical contact: cross-material particle pairs must be found in neighboring spatial-grid cells and be inside a fixed contact radius.

## Miscibility gate

`ΔM = |MA - MB|`. Mixing is permitted only when `ΔM < miscibilityThreshold`.

`compatibility = clamp(1 - ΔM / threshold, 0, 1)`

`reactionRate = baseMixingRate * compatibility^p * contactFactor`

The contact factor rises as particle separation falls.

## Property distance and visual intensity

A normalized weighted distance uses density, viscosity, cohesion, temperature, opacity, reaction potential and color. Miscibility participates in the gate/rate but is deliberately down-weighted in property distance.

High compatibility plus high property distance produces strong flash/impulse feedback; high compatibility plus already-similar properties mixes quietly.

## Local homogenization

Each contacting pair moves local particle properties toward a mass-weighted mean. The engine does not mutate a shared global material definition during contact, preventing remote matter from changing. When local particle vectors become sufficiently close, the pair may canonicalize to one material ID.

The shop enables `MixtureSolver` for conservative, double-buffered diffusion.
Only touching neighbours exchange colour and properties; separating them stops
transport immediately. Per-edge fluxes use the parcels' conserved ml amounts,
so the eventual homogeneous colour retains the full 20/80 proportions even with
unequal densities. Degree normalization keeps dense contact graphs bounded and
pair-order independent. Material-ID canonicalization does not stop transport.
Warmth accelerates diffusion; recent local spoon work adds a stronger multiplier.

Source-family affinity envelopes and saved membership prevent bridging an
incompatible species through an averaged affinity. Batch targets remain legacy
save metadata and are never used to paint remote particles. Transport adds to the
current reaction state rather than restoring consumed potential from a target.

Hydration exchanges conserved dry mass only at compatible, mechanically stirred
condensed contacts. The solvent's melting threshold and gradual kneading progress
are saved. Kneaded grains become a highly viscous liquid suspension, with no
rigid body or spring links; additional stirred solvent reduces its concentration.
Gas cannot hydrate grains, and frozen coherent matter cannot be mixed directly.

Thermal conduction and combustion propagation read a common temperature state
for each solver tick. Pair enumeration order cannot transfer heat across an
entire chain or ignite all its neighbours in the same tick.

## Additional abstract rules

- Thermal shock: large local ΔT produces a turbulence impulse while the thermal solver transfers heat.
- Reaction potential: strongly opposed signed potentials dissipate locally into heat and impulse.
- Immiscible density ordering: density difference adds a small gravity-aligned separation tendency.

These are abstract sandbox rules and must not be interpreted as real chemistry.

