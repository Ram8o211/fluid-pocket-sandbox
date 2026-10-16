import { PARTICLE_ML, insideCauldron } from './cauldron.mjs';
import { INTACT_PIECE_PARTICLES } from './IngredientPieces.mjs';

export const STREAM_RATE = 12; // ml (or measures) per simulation second

/** Simulation-clock pouring: liquids/powders flow as parcels; a crushable
 * reagent enters as an entire coherent item at once, never one grain/tick. */
export class PourStream {
  constructor() { this.reset(); }
  reset() { this.credit = 0; this.ingredientId = null; }
  step(brew, ingredientId, inventory, point, dt, infinite = false) {
    if (!insideCauldron(point.x, point.y, .073)) { this.reset(); return 0; }
    const ingredient = brew.ingredients.find(i => i.id === ingredientId);
    if (!ingredient) { this.reset(); return 0; }
    const intact = Boolean(ingredient.crushable && ingredient.form &&
      !['liquid', 'water', 'powder'].includes(ingredient.form));
    const wholeMl = INTACT_PIECE_PARTICLES * PARTICLE_ML;
    // A tap deposits one complete solid immediately. Continuing to hold drops
    // one further piece per appropriate volume of time, not separate grains.
    if (this.ingredientId !== ingredientId) {
      this.credit = intact ? wholeMl : 0;
      this.ingredientId = ingredientId;
    }
    const available = Math.max(0, Math.floor((Math.min(
      infinite ? Infinity : inventory[ingredientId] || 0,
      brew.capacity - brew.occupiedVolume,
      (brew.engine.ps.capacity - brew.engine.ps.count) * PARTICLE_ML
    ) + 1e-8) / PARTICLE_ML) * PARTICLE_ML);
    if (available < PARTICLE_ML) { this.reset(); return 0; }
    // Near the end of stock or capacity, a smaller last piece is still one
    // coherent body. Nothing silently disappears or gets poured as powder.
    const unit = intact ? Math.min(wholeMl, available) : PARTICLE_ML;
    this.credit = Math.min(unit * 2, this.credit + STREAM_RATE * dt);
    let added = 0;
    while (this.credit >= unit - 1e-8) {
      const amount = brew.pour(ingredientId, unit, inventory, { point, infinite, continuous: true });
      if (!amount) {
        // A blocked whole-item nozzle retries as the finger moves; it never
        // accumulates multiple items for a single explosive catch-up frame.
        this.credit = intact ? unit : 0;
        break;
      }
      this.credit -= amount; added += amount;
      if (intact) break;
    }
    return added;
  }
}
