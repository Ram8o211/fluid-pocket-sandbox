import { availableIngredients } from './world.mjs';

/** @type {Array<[string,number,string,string,number,number,number,number]>} */
const BEDS = [
  ['spring',1,'Spring well','spring',.16,.62,0,0],
  ['grove-2',2,'Ironroot bed','woodland',.23,.25,20,480000],
  ['meadow-3',3,'Heartpetal bed','meadow',.54,.70,16,540000],
  ['bank-4',4,'Ember nursery','riverbank',.77,.30,16,900000],
  ['grove-5',5,'Frostcap bed','woodland',.43,.34,16,600000],
  ['thicket-6',6,'Nightshade bed','woodland',.72,.63,12,720000],
  ['grove-7',7,'Mandrake bed','woodland',.10,.36,10,960000],
  ['grove-8',8,'Shadow moss bed','woodland',.62,.14,10,1080000],
  ['bank-9',9,'Quartz nursery','riverbank',.88,.46,10,1200000],
  ['bank-10',10,'Chalk nursery','riverbank',.36,.81,18,720000],
  ['bank-11',11,'Mica bed','riverbank',.81,.82,18,720000],
  ['sap-12',12,'Phoenix tree','woodland',.32,.50,20,840000],
  ['dew-13',13,'Moonflowers','meadow',.60,.46,20,780000],
  ['nectar-14',14,'Dream blossoms','meadow',.47,.17,16,960000]
];
const LOCATIONS = BEDS.map(([id,ingredientId,name,biome,x,y,capacity,regrowMs])=>({id,ingredientId,name,biome,x,y,capacity,regrowMs,unlimited:ingredientId===1}));
const timestamp = now => Number.isFinite(now) ? Math.max(0, now) : Date.now();
export const GARDEN_STOCK_LIMIT = 72;
export function createForaging(world, now = Date.now()) {
  const time = timestamp(now), ids = new Set(world.ingredients.map(i => i.id));
  return { seed: world.seed, collectedTotal: 0, stamina: 100, staminaAt: time,
    nodes: LOCATIONS.filter(node => ids.has(node.ingredientId)).map(node => ({ ...node, maxStock: node.capacity, stock: node.capacity, updatedAt: time, harvests: 0, tendedUntil: 0 })) };
}
export function gardenStamina(state, now = Date.now()) {
  const garden = state.foraging || state;
  return Math.min(100, (garden.stamina ?? 100) + Math.max(0, timestamp(now) - (garden.staminaAt ?? timestamp(now))) / 7000);
}
function spendStamina(state, cost, now) {
  if (state.mode === 'sandbox') return;
  const available = gardenStamina(state, now);
  if (available < cost) throw new Error('Rest a little before tending another bed.');
  state.foraging.stamina = available - cost; state.foraging.staminaAt = now;
}
export function resourceStatus(state, nodeId, now = Date.now()) {
  const shop = state.foraging ? state : null, garden = state.foraging || state;
  const node = garden?.nodes?.find(n => n.id === nodeId);
  if (!node) throw new Error('Choose a garden bed.');
  const time = timestamp(now), unlimited = node.unlimited || shop?.mode === 'sandbox';
  const capacity = node.capacity ?? node.maxStock, elapsed = Math.max(0, time - node.updatedAt);
  const boostTime = Math.max(0, Math.min(time, node.tendedUntil || 0) - node.updatedAt);
  const stock = node.unlimited ? 0 : Math.min(capacity, node.stock + (elapsed + boostTime) * capacity / node.regrowMs);
  const available = unlimited ? Infinity : Math.floor(stock + 1e-9), minimum = 5;
  const nextReadyAt = unlimited || available >= minimum ? time : time + (minimum - stock) * node.regrowMs / capacity;
  const fullAt = node.unlimited ? time : time + Math.max(0, capacity - stock) * node.regrowMs / capacity;
  const locked = Boolean(shop && shop.mode !== 'sandbox' && !availableIngredients(shop.world, shop.equipment).some(i => i.id === node.ingredientId));
  return { ...node, nodeId: node.id, stock, capacity, maxStock: capacity, available, unlimited, locked,
    depleted: !unlimited && available < minimum, nextReadyAt, fullAt, stamina: gardenStamina(state, time) };
}
/** A deliberate timed harvest uses one small basket. Poor timing wastes part
 * of the picked crop; waiting offline never accumulates beyond the bed cap. */
export function gatherIngredient(state, nodeId, quantity = 10, now = Date.now(), options = {}) {
  if (!state.world || !state.inventory || !state.foraging) throw new Error('The garden is not ready.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Choose a positive harvest quantity.');
  const time = timestamp(now), status = resourceStatus(state, nodeId, time);
  if (status.locked) throw new Error('Unlock this garden bed through the guild.');
  if (status.depleted) throw new Error('Let at least five measures ripen before harvesting.');
  const room = status.unlimited ? Infinity : (GARDEN_STOCK_LIMIT + (state.equipment?.viscometer ? 24 : 0)) - (state.inventory[status.ingredientId] || 0);
  if (room <= 0) throw new Error('Your ingredient jar is full. Brew before gathering more.');
  const picked = Math.floor(Math.min(quantity, status.available, status.unlimited ? Infinity : 10, room));
  if (!picked) throw new Error('This bed is resting.');
  if (!status.unlimited) spendStamina(state, state.equipment?.viscometer ? 9 : 12, time);
  const precision = Math.min(1, Math.max(0, options.precision ?? 1));
  const gathered = status.unlimited ? picked : Math.max(1, Math.floor(picked * (.4 + .6 * precision)));
  const node = state.foraging.nodes.find(n => n.id === nodeId);
  if (!status.unlimited) { node.stock = Math.max(0, status.stock - picked); node.updatedAt = time; node.harvests = (node.harvests || 0) + 1; }
  state.inventory[status.ingredientId] = (state.inventory[status.ingredientId] || 0) + gathered;
  state.foraging.collectedTotal += gathered;
  const after = resourceStatus(state, nodeId, time);
  return { nodeId, ingredientId: status.ingredientId, quantity: gathered, wasted: picked - gathered,
    remaining: after.available, nextReadyAt: after.nextReadyAt, unlimited: status.unlimited };
}
export function tendGarden(state, nodeId, now = Date.now()) {
  const time = timestamp(now), status = resourceStatus(state, nodeId, time);
  if (status.locked || status.unlimited) throw new Error('Choose an unlocked growing bed.');
  if (status.tendedUntil > time) throw new Error('This bed is already tended.');
  if ((state.inventory[1] || 0) < 5) throw new Error('Collect five ml of water first.');
  spendStamina(state, 6, time); state.inventory[1] -= 5;
  const node = state.foraging.nodes.find(n => n.id === nodeId);
  node.stock = status.stock; node.updatedAt = time; node.tendedUntil = time + 120000;
  return node;
}
