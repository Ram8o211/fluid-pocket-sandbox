import { PARTICLE_ML, insideCauldron } from './cauldron.mjs';

export const STREAM_RATE = 12; // ml (or measures) per simulation second

/** Simulation-clock emission: no interval-sized doses, catch-up bursts, or
 * accumulated credit while the nozzle is blocked/outside the vessel. */
export class PourStream {
  constructor() { this.reset(); }
  reset() { this.credit = 0; }
  step(brew, ingredientId, inventory, point, dt, infinite = false) {
    if (!insideCauldron(point.x, point.y, .073)) { this.reset(); return 0; }
    this.credit = Math.min(PARTICLE_ML * 2, this.credit + STREAM_RATE * dt);
    let added = 0;
    while (this.credit >= PARTICLE_ML - 1e-8) {
      const amount = brew.pour(ingredientId, PARTICLE_ML, inventory, { point, infinite, continuous: true });
      if (!amount) { this.reset(); break; }
      this.credit -= amount; added += amount;
    }
    return added;
  }
}
