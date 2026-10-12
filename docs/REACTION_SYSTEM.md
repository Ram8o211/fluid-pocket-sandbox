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

The shop additionally enables `MixtureSolver`: first physical contact joins
compatible source families and fixes their target using measured amounts of the entire
remaining mixture. Contact activation propagates locally from neighbours using a
previous-frame field; colour and all mixing channels relax smoothly toward that
target, including after local material IDs canonicalize. An inactive remote
parcel keeps its current properties. Warmth and movement accelerate relaxation.
Original affinity envelopes prevent averaged affinities or bridging ingredients
from admitting incompatible sources. New stock, representative drains and
combustion update the remaining source weights; saves preserve targets and local
progress. Reactive potential/heat targets follow chemistry's current state.

Thermal conduction and combustion propagation read a common temperature state
for each solver tick. Pair enumeration order cannot transfer heat across an
entire chain or ignite all its neighbours in the same tick.

## Additional abstract rules

- Thermal shock: large local ΔT produces a turbulence impulse while the thermal solver transfers heat.
- Reaction potential: strongly opposed signed potentials dissipate locally into heat and impulse.
- Immiscible density ordering: density difference adds a small gravity-aligned separation tendency.

These are abstract sandbox rules and must not be interpreted as real chemistry.

