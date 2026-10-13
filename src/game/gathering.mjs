import { availableIngredients } from './world.mjs';

const LOCATIONS = Object.freeze([
  { id: 'spring', ingredientId: 1, name: 'Clearwater Spring', biome: 'spring', x: .19, y: .62, capacity: 0, regrowMs: 0, unlimited: true },
  { id: 'grove-2', ingredientId: 2, name: 'Ironroot Grove', biome: 'woodland', x: .24, y: .27, capacity: 80, regrowMs: 90000 },
  { id: 'meadow-3', ingredientId: 3, name: 'Heartpetal Meadow', biome: 'meadow', x: .56, y: .69, capacity: 60, regrowMs: 75000 },
  { id: 'bank-4', ingredientId: 4, name: 'Ember Outcrop', biome: 'riverbank', x: .78, y: .31, capacity: 60, regrowMs: 150000 },
  { id: 'grove-5', ingredientId: 5, name: 'Frostcap Glade', biome: 'woodland', x: .45, y: .34, capacity: 60, regrowMs: 105000 },
  { id: 'thicket-6', ingredientId: 6, name: 'Nightshade Thicket', biome: 'woodland', x: .72, y: .63, capacity: 40, regrowMs: 120000 },
  { id: 'grove-7', ingredientId: 7, name: 'Mandrake Hollow', biome: 'woodland', x: .1, y: .37, capacity: 30, regrowMs: 180000 },
  { id: 'grove-8', ingredientId: 8, name: 'Ancient Moss Grove', biome: 'woodland', x: .63, y: .13, capacity: 30, regrowMs: 210000 },
  { id: 'bank-9', ingredientId: 9, name: 'Starlight Vein', biome: 'riverbank', x: .89, y: .46, capacity: 30, regrowMs: 240000 },
  { id: 'bank-10', ingredientId: 10, name: 'Chalk Riverbank', biome: 'riverbank', x: .38, y: .8, capacity: 60, regrowMs: 135000 },
  { id: 'bank-11', ingredientId: 11, name: 'Mica Sandbank', biome: 'riverbank', x: .82, y: .82, capacity: 60, regrowMs: 120000 }
]);

const timestamp = now => Number.isFinite(now) ? Math.max(0, now) : Date.now();

/** No timers or frame updates: depleted patches regrow when queried or gathered. */
export function createForaging(world, now = Date.now()) {
  const time = timestamp(now), ids = new Set(world.ingredients.map(i => i.id));
  return { seed: world.seed, collectedTotal: 0,
    nodes: LOCATIONS.filter(node => ids.has(node.ingredientId)).map(node => ({ ...node,
      maxStock: node.capacity, stock: node.capacity, updatedAt: time, unlimited: Boolean(node.unlimited)
    })) };
}

function context(state) {
  return state.foraging ? { shop: state, foraging: state.foraging } : { shop: null, foraging: state };
}

/** Resolves a resource's stock without mutating its timestamp or running timers. */
export function resourceStatus(state, nodeId, now = Date.now()) {
  const { shop, foraging } = context(state);
  const node = foraging?.nodes?.find(n => n.id === nodeId);
  if (!node) throw new Error('Choose a gathering patch.');
  const time = timestamp(now), unlimited = Boolean(node.unlimited) || shop?.mode === 'sandbox';
  const capacity = node.capacity ?? node.maxStock;
  const elapsed = Math.max(0, time - node.updatedAt);
  const stock = node.unlimited ? 0 : Math.min(capacity, node.stock + elapsed * capacity / node.regrowMs);
  const available = unlimited ? Infinity : Math.max(0, Math.floor(stock + 1e-9));
  const nextReadyAt = unlimited || available > 0 ? time : time + (1 - stock) * node.regrowMs / capacity;
  const fullAt = node.unlimited ? time : time + Math.max(0, capacity - stock) * node.regrowMs / capacity;
  const locked = Boolean(shop && shop.mode !== 'sandbox' && !availableIngredients(shop.world, shop.equipment).some(i => i.id === node.ingredientId));
  return { ...node, nodeId: node.id, stock, capacity, maxStock: capacity, available,
    unlimited, locked, depleted: !unlimited && available === 0, nextReadyAt, fullAt };
}

/** Gathering grants real stock; sandbox grants stock without consuming patches. */
export function gatherIngredient(state, nodeId, quantity = 20, now = Date.now()) {
  if (!state.world || !state.inventory || !state.foraging) throw new Error('The gathering room is not ready.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Choose a positive gathering quantity.');
  const time = timestamp(now), status = resourceStatus(state, nodeId, time);
  if (status.locked) throw new Error('Unlock this rare ingredient through the guild first.');
  const gathered = Math.floor(Math.min(quantity, status.available));
  if (!gathered) throw new Error('This patch is resting. Let it regrow before gathering again.');
  const node = state.foraging.nodes.find(n => n.id === nodeId);
  if (!status.unlimited) {
    node.stock = Math.max(0, status.stock - gathered); node.updatedAt = time;
  }
  state.inventory[status.ingredientId] = (state.inventory[status.ingredientId] || 0) + gathered;
  state.foraging.collectedTotal = (state.foraging.collectedTotal || 0) + gathered;
  const after = resourceStatus(state, nodeId, time);
  return { nodeId, ingredientId: status.ingredientId, quantity: gathered,
    remaining: after.available, nextReadyAt: after.nextReadyAt, unlimited: status.unlimited };
}
