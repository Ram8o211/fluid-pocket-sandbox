/**
 * Public gameplay contracts. Physics temperatures/densities are normalized engine
 * units; quantities shown to players are ml. One emitted particle initially holds
 * .25 ml (mass = ingredient density × .25). Solvers may split/change that mass.
 *
 * @typedef {string} WorldSeed
 * @typedef {{id:number, name:string, material:object, price:number, starter:boolean, lore:string, form?:string}} Ingredient
 * @typedef {{volume:number, mass:number, color:string, density:number, viscosity:number, temperature:number, volatility:number, stability:number, potency:number, strength:number, love:number, death:number, transformation:number, fire:number, freeze:number, acidity:number, poison:number, effects:object, liquidFraction:number, composition:object, history:object, cost:{ingredients:number,energy:number}}} PotionSample
 * @typedef {{id:string, name:string, role:string, portraitSeed:number, dialogue:string}} Customer
 * @typedef {{property:string, target:number|string, tolerance:number, weight:number, hard:boolean, comparison?:string, minimum?:number}} Requirement
 * @typedef {{id:string, customer:Customer, requirements:Requirement[], volume:number, budget:number, difficulty:number, witness:object, clue:string}} CustomerOrder
 * @typedef {{thermometer:boolean, densimeter:boolean, viscometer:boolean, analyzer:boolean, furnace:number, cauldron:number, reagents:number}} LaboratoryEquipment
 * @typedef {{version:number, seed:WorldSeed, coins:number, reputation:number, completed:number, inventory:object, equipment:LaboratoryEquipment, discoveries:object[], order:CustomerOrder, pendingBottle:PotionSample|null, lastSale:object|null, tutorial:number, settings:object, brew:object|null}} ShopState
 * @typedef {{orderId:string, quality:number, payment:number, profit:number, expenses:number, reputationDelta:number, breakdown:object[], reaction:string}} SaleResult
 */
export const SAVE_VERSION = 5;
export const FIXED_STEP = 1 / 40;
export const ROOM_TEMPERATURE = .33;
// Fixed reference for the empty atmosphere: above every supported material's
// vapour density (.85 maximum), independent of the brew's amount/composition.
export const ROOM_DENSITY = 1;
export const CAPACITY_ML = [200, 320, 440];
export const PACKAGING_COST = 1;
export const PROPERTIES = Object.freeze({
  color: { label: 'Colour', tolerance: .15 },
  density: { label: 'Density', tolerance: .12 },
  viscosity: { label: 'Texture', tolerance: .14 },
  temperature: { label: 'Temperature', tolerance: .09 },
  volatility: { label: 'Volatility', tolerance: .14 },
  stability: { label: 'Stability', tolerance: 16 },
  potency: { label: 'Arcane glow', tolerance: 14 },
  strength: { label: 'Strength', tolerance: .12 },
  love: { label: 'Love', tolerance: .12 },
  death: { label: 'Death', tolerance: .09 },
  transformation: { label: 'Transformation', tolerance: .12 },
  fire: { label: 'Fire', tolerance: .12 },
  freeze: { label: 'Frost', tolerance: .12 },
  acidity: { label: 'Withering', tolerance: .1 },
  poison: { label: 'Venom', tolerance: .09 }
});
