import { availableIngredients } from './world.mjs';
import { generateOrder } from './orders.mjs';
import { priceSale } from './evaluation.mjs';
import { SAVE_VERSION } from './contracts.mjs';
import { clamp } from '../simulation/math.mjs';

export const UPGRADES = Object.freeze([
  { id: 'densimeter', name: 'Density stone', cost: 35, sales: 1, description: 'Weigh each brew and reveal its density.' },
  { id: 'viscometer', name: 'Flow glass', cost: 55, sales: 2, description: 'Measure texture and volatility.' },
  { id: 'analyzer', name: 'Arcane prism', cost: 85, sales: 3, description: 'Reveal magical intensity and lasting stability.' },
  { id: 'furnace', name: 'Copper furnace', cost: 110, sales: 4, description: 'A stronger flame and finer thermal controls.' },
  { id: 'cauldron', name: 'Deep cauldron', cost: 140, sales: 5, description: 'Increase capacity to 320 ml.', level: 1 },
  { id: 'reagents', name: 'Guild reagents I', cost: 95, sales: 4, description: 'Discover a rare extract; includes 120 ml.', level: 1 },
  { id: 'reagents', name: 'Guild reagents II', cost: 160, sales: 7, description: 'Another rare reagent, with 120 ml.', level: 2 },
  { id: 'cauldron', name: 'Master cauldron', cost: 240, sales: 9, description: 'Increase capacity to 440 ml.', level: 2 },
  { id: 'reagents', name: 'Guild reagents III', cost: 220, sales: 10, description: 'Unlock the final guild reagent, with 120 ml.', level: 3 }
]);

export function newShop(world) {
  const equipment = { thermometer: true, densimeter: false, viscometer: false, analyzer: false, furnace: 0, cauldron: 0, reagents: 0 };
  return { version: SAVE_VERSION, seed: world.seed, world, coins: 80, debt: 0, reputation: 0, completed: 0,
    inventory: Object.fromEntries(world.ingredients.map(i => [i.id, i.starter ? 240 : 0])), equipment,
    discoveries: [], order: generateOrder(world, 0, equipment), pendingBottle: null, lastSale: null,
    tutorial: 0, settings: { sound: true, graphics: 'balanced' }, brew: null, stage: 'brewing', soldOrderIds: [] };
}

export function restock(state, ingredientId, ml = 60) {
  const ingredient = availableIngredients(state.world, state.equipment).find(i => i.id === ingredientId);
  if (!ingredient || !Number.isFinite(ml) || ml <= 0) throw new Error('Choose an available reagent.');
  const quantity = Math.floor(ml), cost = Math.ceil(quantity * ingredient.price);
  if (!quantity || state.coins < cost) throw new Error(`You need ${cost} coins for this refill.`);
  state.coins = Math.round((state.coins - cost) * 100) / 100;
  state.inventory[ingredientId] = (state.inventory[ingredientId] || 0) + quantity;
  return { quantity, cost };
}

export function upgradeStatus(state, upgrade) {
  const owned = upgrade.level ? (state.equipment[upgrade.id] || 0) >= upgrade.level : Boolean(state.equipment[upgrade.id]);
  const previous = !upgrade.level || (state.equipment[upgrade.id] || 0) === upgrade.level - 1;
  return { owned, available: !owned && previous && state.completed >= upgrade.sales, affordable: state.coins >= upgrade.cost };
}

export function buyUpgrade(state, index) {
  const upgrade = UPGRADES[index]; if (!upgrade) throw new Error('Unknown upgrade.');
  const status = upgradeStatus(state, upgrade);
  if (!status.available || !status.affordable) throw new Error('This upgrade is not available yet.');
  state.coins -= upgrade.cost; state.equipment[upgrade.id] = upgrade.level || 1;
  if (upgrade.id === 'reagents') state.inventory[6 + upgrade.level] = 120;
  return upgrade;
}

export function completeSale(state) {
  if (!state.pendingBottle || !state.order || state.soldOrderIds.includes(state.order.id)) throw new Error('This vial has already been sold.');
  const sale = priceSale(state.pendingBottle, state.order, state.reputation);
  if (state.coins + sale.payment < sale.expenses) throw new Error('You need one coin for a fresh vial.');
  const repayment = Math.min(state.debt || 0, Math.floor(sale.payment * .35));
  state.coins = Math.round((state.coins + sale.payment - sale.expenses - repayment) * 100) / 100;
  state.debt = Math.max(0, (state.debt || 0) - repayment);
  state.reputation = clamp(state.reputation + sale.reputationDelta, 0, 100);
  state.completed++; state.soldOrderIds.push(state.order.id); state.soldOrderIds = state.soldOrderIds.slice(-100);
  state.lastSale = { ...sale, customer: state.order.customer, sample: state.pendingBottle, repayment };
  state.pendingBottle = null; state.stage = 'sale';
  return state.lastSale;
}

export function nextCustomer(state) {
  if (state.stage !== 'sale') throw new Error('Finish this commission first.');
  state.order = generateOrder(state.world, state.completed, state.equipment); state.stage = 'brewing';
  return state.order;
}

export function recordDiscovery(state, sample, name = '') {
  if (!sample || sample.volume < 1) throw new Error('Measure or bottle a potion first.');
  const discovery = { id: `discovery-${state.completed}-${state.discoveries.length}`, name: String(name || `Experiment ${state.discoveries.length + 1}`).trim().slice(0, 40), sample: structuredClone(sample), orderId: state.order?.id };
  state.discoveries.unshift(discovery); state.discoveries = state.discoveries.slice(0, 80);
  return discovery;
}

// Recovery is a repayable loan, never a free refill or a repeatable money faucet.
export function guildLoan(state) {
  const stockValue = availableIngredients(state.world, state.equipment).reduce((n, i) => n + (state.inventory[i.id] || 0) * i.price, 0);
  if (state.debt > 0 || state.coins + stockValue > 15) throw new Error('Guild aid is reserved for penniless apprentices with no outstanding loan.');
  state.coins += 25; state.debt = 30;
}
