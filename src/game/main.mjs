import { generateWorld, availableIngredients } from './world.mjs';
import { BrewingSession } from './brewing.mjs';
import { newShop, restock, tradeStock, discardVial, UPGRADES, upgradeStatus, buyUpgrade, completeSale, nextCustomer, recordDiscovery, guildLoan } from './economy.mjs';
import { assessPotion, priceSale } from './evaluation.mjs';
import { saveShop, loadShop, encodeSave, decodeSave, SANDBOX_SAVE_KEY } from './persistence.mjs';
import { propertyDescription } from './potion.mjs';
import { FIXED_STEP, PROPERTIES } from './contracts.mjs';
import { LaboratoryRenderer } from './LaboratoryRenderer.mjs';
import { icon, bottleSprite, ingredientSprite, naturalLandscapeSprite, experimentSubjectSprite, portraitSprite, workshopBackground } from './art.mjs';
import { resourceStatus, gatherIngredient } from './gathering.mjs';
import { runExperiment, resetExperimentSubject, splitPotionSample } from './experiments.mjs';
import { EFFECT_DEFINITIONS, EFFECT_PROPERTIES } from './effects.mjs';
import { ShopAudio } from './audio.mjs';
import { AdaptiveQuality } from '../performance/AdaptiveQuality.mjs';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const audio = new ShopAudio();
const adaptiveQuality = new AdaptiveQuality();
let state = null, brew = null, renderer = null, loaded = null;
let selected = 1, dose = 20, inShop = false, assist = false, pointer = null, tool = 'spoon';
let last = performance.now(), accumulator = 0, lastHUD = 0, lastRender = 0;
let toastTimer = 0, holdTimer = 0, holdInterval = 0, lastAutosave = 0, saveFailed = false;
let latestInspection = null, selectedRecipe = null;
let sandboxLoaded = null, roomTimer = 0, currentRoom = null, experimentReport = null;
const isSandbox = () => state?.mode === 'sandbox';
const rawIngredient = i => Boolean(i.form && !['liquid', 'powder'].includes(i.form));
const ingredientUnit = i => i.form && i.form !== 'liquid' ? 'measures' : 'ml';

function notify(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}
function randomSeed() {
  const bytes = new Uint32Array(1); crypto.getRandomValues(bytes);
  return `moon-${bytes[0].toString(36)}`;
}
function persist() {
  if (!state || !brew) return;
  try {
    const savedState = saveShop(localStorage, state, brew, isSandbox() ? SANDBOX_SAVE_KEY : undefined);
    if (isSandbox()) sandboxLoaded = { state: savedState, error: '' };
    else loaded = { state: savedState, error: '' };
    saveFailed = false;
    $('saveStatus').textContent = isSandbox() ? 'Sandbox saved separately' : 'Saved on this device'; $('continueBtn').disabled = !loaded?.state;
    lastAutosave = performance.now();
  } catch (err) {
    $('saveStatus').textContent = 'Save unavailable';
    if (!saveFailed) notify('Could not save. Export your shop from Settings to keep it.');
    saveFailed = true;
  }
}
function guard(action) {
  return (...args) => { try { return action(...args); } catch (err) { notify(err.message || 'That action could not be completed.'); } };
}
function sheet(title, content, footer = '') {
  clearInterval(roomTimer); roomTimer = 0; currentRoom = null;
  assist = false; pointer = null; stopPour();
  $('sheetContent').innerHTML = `<header class="sheet-header"><h2 id="sheetTitle">${escape(title)}</h2><button class="icon-button" data-action="close" aria-label="Close panel">${icon('close')}</button></header><div class="sheet-body">${content}</div>${footer ? `<div class="sheet-footer">${footer}</div>` : ''}`;
  if (!$('sheet').open) $('sheet').showModal();
}
function closeSheet() { clearInterval(roomTimer); roomTimer = 0; currentRoom = null; if ($('sheet').open) $('sheet').close(); }

async function openWorld(seed, saved = null, mode = 'shop') {
  $('newWorldBtn').disabled = true; $('continueBtn').disabled = true;
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const world = saved?.world || generateWorld(seed);
    const candidate = saved || newShop(world, { sandbox: mode === 'sandbox' });
    const session = new BrewingSession(world.ingredients, candidate.equipment);
    if (saved?.brew) session.restore(saved.brew);
    state = candidate; brew = session; selected = availableIngredients(world, state.equipment)[0].id; experimentReport = null;
    renderer = new LaboratoryRenderer($('labCanvas'), brew); renderer.setQuality(state.settings.graphics);
    audio.enabled = state.settings.sound;
    inShop = true; accumulator = 0; $('menu').hidden = true; $('shop').hidden = false;
    $('ingredientRack').scrollLeft = 0;
    closeSheet(); renderAll(); persist();
    if (state.stage === 'sale' && state.lastSale) showSale();
    else if (state.pendingBottle) showVial();
    else notify(isSandbox() ? 'Infinite ingredients, every instrument, and room to experiment.' : saved ? 'Welcome back to your shop.' : 'Your first customer is here. Gather, grind, and brew.');
  } catch (err) { notify(err.message); $('saveMessage').textContent = 'This save has been preserved. You can open a new shop with another seed.'; }
  finally { $('newWorldBtn').disabled = false; $('continueBtn').disabled = !loaded?.state; }
}
function menu() {
  if (state) persist(); inShop = false; assist = false; stopPour(); closeSheet();
  $('menu').hidden = false; $('shop').hidden = true; document.body.dataset.gameState = 'menu';
  $('continueBtn').disabled = !loaded?.state; $('saveMessage').textContent = loaded?.error || 'Your shop saves automatically on this device.';
}
function startNew() {
  const seed = $('worldSeed').value.trim() || randomSeed();
  if (loaded?.state) {
    sheet('A new beginning', `<p>Open a shop in <strong>${escape(seed)}</strong>? This replaces your current shop on this device. You can export the current shop from Settings first.</p><div class="confirm-actions"><button data-action="close">Keep my shop</button><button class="primary" data-action="confirm-new">Open new world</button></div>`);
  } else openWorld(seed);
}
function renderAll() {
  if (!state) return;
  $('coins').innerHTML = `${icon('coin')}<span>${isSandbox() ? '∞' : Math.floor(state.coins)}</span>`;
  $('reputation').innerHTML = `${icon('star')}${isSandbox() ? 'Sandbox' : `Reputation ${state.reputation}`}`;
  $('orderPanel').hidden = isSandbox(); $('sandboxNotice').hidden = !isSandbox();
  $('settingsBtn').innerHTML = icon('settings'); $('skipTutorial').innerHTML = icon('close');
  $('worldLabel').textContent = `World: ${state.seed}`;
  const order = state.order;
  $('customerPortrait').src = portraitSprite(order.customer.portraitSeed);
  $('customerName').textContent = order.customer.name; $('customerRole').textContent = order.customer.role;
  $('orderNumber').textContent = `COMMISSION ${state.completed + 1} · ${order.volume} ML`;
  $('orderBudget').innerHTML = `${order.budget} ${icon('coin')}`;
  $('customerDialogue').textContent = order.customer.dialogue;
  $('requirements').innerHTML = order.requirements.map(r => `<div class="requirement">${r.property === 'color' ? `<span class="colour-swatch" style="background:${escape(r.target)}"></span>` : icon(r.property === 'temperature' ? 'flame' : r.property === 'potency' ? 'star' : r.property === 'stability' ? 'frost' : 'measure')}<div><span class="req-label">${PROPERTIES[r.property].label.toUpperCase()}${r.hard ? ' · REQUIRED' : ''}</span><span class="req-target">${escape(propertyDescription(r.property, r.target))}</span></div></div>`).join('');
  $('orderClue').textContent = order.clue;
  for (const [id, sprite, label] of [['measureBtn', 'measure', 'Inspect'], ['inventoryBtn', 'inventory', 'Ingredients'], ['bookBtn', 'book', 'Recipe book'], ['upgradesBtn', 'guild', 'Guild']]) $(id).innerHTML = icon(sprite) + `<span>${label}</span>`;
  $('natureBtn').innerHTML = `${icon('leaf')}<span>Wild garden</span>`;
  $('experimentsBtn').innerHTML = `${icon('flask')}<span>Experiments room</span>`;
  renderRack(); renderTools(); updateHUD(); updateTutorial();
  document.body.dataset.gameState = state.stage;
}
function renderRack() {
  const rack = $('ingredientRack'), scroll = rack.scrollLeft, ingredients = availableIngredients(state.world, state.equipment);
  rack.innerHTML = ingredients.map(i => `<button class="ingredient-card${i.id === selected ? ' selected' : ''}" data-ingredient="${i.id}" aria-label="Select ${escape(i.name)}, ${i.form || 'liquid'}" aria-pressed="${i.id === selected}"><img src="${ingredientSprite(i)}" alt=""><span>${escape(i.name)}</span><small>${escape(i.form || 'liquid')} · ${isSandbox() ? '∞' : Math.floor(state.inventory[i.id] || 0)} ${ingredientUnit(i)}</small></button>`).join('');
  rack.scrollLeft = scroll;
  const ingredient = ingredients.find(i => i.id === selected) || ingredients[0]; selected = ingredient.id;
  $('selectedName').textContent = ingredient.name + (ingredient.form && ingredient.form !== 'liquid' ? ` · ${ingredient.form}` : '');
  $('doseUnit').textContent = ingredientUnit(ingredient) === 'ml' ? 'ml' : 'qty';
  const action = ingredient.form && ingredient.form !== 'liquid' ? 'Add' : 'Pour';
  $('pourBtn').innerHTML = `${icon('vial')}${action} ${dose}${ingredientUnit(ingredient) === 'ml' ? ' ml' : ' whole'}`;
  if (ingredient.form === 'powder') $('pourBtn').innerHTML = `${icon('vial')}Add ${dose} powder`;
  $('pourBtn').setAttribute('aria-label', `${action} ${dose} ${ingredientUnit(ingredient)} of ${ingredient.name}`);
  $('pourBtn').disabled = Boolean(state.pendingBottle) || state.stage === 'sale';
  $('grindBtn').hidden = !rawIngredient(ingredient);
  $('grindBtn').textContent = `Grind & add ${dose} measures`;
  $('grindBtn').disabled = $('pourBtn').disabled;
}
function renderTools() {
  $('heatBtn').innerHTML = `${icon('flame')}<span>Flame <small>${brew.heat ? `${Math.round(brew.heat * 100)}%` : 'OFF'}</small></span>`;
  $('heatBtn').classList.toggle('active', brew.heat > 0); $('heatBtn').setAttribute('aria-label', `Adjust flame, ${Math.round(brew.heat * 100)} percent`);
  $('coolBtn').innerHTML = `${icon('frost')}<span>Frost <small>${brew.cool ? `${Math.round(brew.cool * 100)}%` : 'OFF'}</small></span>`;
  $('coolBtn').classList.toggle('cold', brew.cool > 0); $('coolBtn').setAttribute('aria-label', `Adjust cooling, ${Math.round(brew.cool * 100)} percent`);
  $('stirBtn').innerHTML = `${icon('spoon')}<span>Stir <small>HOLD</small></span>`;
  $('crushBtn').innerHTML = `${icon('spoon')}<span>Pestle <small>CRUSH</small></span>`;
  $('crushBtn').classList.toggle('active', tool === 'pestle'); $('crushBtn').setAttribute('aria-pressed', String(tool === 'pestle'));
  $('cleanBtn').innerHTML = `${icon('clean')}<span>Clean <small>CAULDRON</small></span>`;
  for (const id of ['heatBtn', 'coolBtn', 'stirBtn', 'crushBtn', 'cleanBtn']) $(id).disabled = Boolean(state.pendingBottle) || state.stage === 'sale';
}
function updateHUD() {
  if (!brew || !state) return;
  const volume = brew.liquidVolume;
  const steam = brew.vaporVolume, condensing = steam > .01;
  $('volume').textContent = isSandbox() ? `${Math.round(volume)} ml liquid · ${Math.round(brew.occupiedVolume)} / ${brew.capacity}` : `${Math.round(volume)} / ${state.order.volume} ml`;
  $('labStatus').textContent = state.pendingBottle ? 'VIAL READY' : state.stage === 'sale' ? 'COMMISSION COMPLETE' : condensing ? `SEALED · ${steam.toFixed(1)} ML STEAM` : `SEALED CAULDRON · ${brew.capacity} ML`;
  $('labHint').textContent = state.pendingBottle ? isSandbox() ? 'Test your vial in the experiments room' : 'Test the potion or serve your customer' : condensing ? brew.heat ? 'Steam is trapped · turn off Flame to condense' : 'Steam is condensing · Frost helps it return faster' : brew.engine.ps.count ? brew.heat ? 'Warmth helps ground ingredients blend with water' : brew.cool ? 'Frost cools the brew and condenses trapped steam' : 'Grind plants and stones · stir with plenty of water' : 'Start with water · grind a little plant or stone';
  $('bottleBtn').innerHTML = `${icon(state.stage === 'sale' ? 'arrow' : 'vial')}${state.stage === 'sale' ? 'Next customer' : state.pendingBottle ? isSandbox() ? 'Inspect vial' : 'Review & sell' : condensing ? 'Wait for condensation' : `Bottle ${isSandbox() ? dose : state.order.volume} ml`}`;
  $('bottleBtn').disabled = state.stage !== 'sale' && !state.pendingBottle && (volume < 1 || condensing);
  $('bottleBtn').title = condensing ? 'Cool the trapped steam back into liquid before bottling.' : '';
  $('crushBtn').setAttribute('aria-pressed', String(tool === 'pestle')); $('crushBtn').classList.toggle('active', tool === 'pestle');
  if (tool === 'pestle' && !state.pendingBottle && !condensing) $('labHint').textContent = 'Tap or drag the pestle on raw or frozen matter';
  $('stirBtn').setAttribute('aria-pressed', String(assist)); $('stirBtn').classList.toggle('active', assist);
}
const TUTORIAL = [
  'Welcome, apprentice! Start with Plain Water. Gather plants and stones in the Wild garden.',
  'Each tap pours 20 ml. Pour three times to fill the customer’s 60 ml vial.',
  'Grind a little raw ingredient, then stir it into plenty of water. At least six parts water helps powders dissolve.',
  'Flame speeds up mixing. The lid traps steam: turn Flame off or use Frost, then wait for condensation.',
  'Inspect the brew. Try a 5 ml dose in the Experiments room to discover its effects before selling.',
  'Tap Bottle to seal the measured liquid in a vial. Only liquid can be bottled.',
  'Tap Sell in the vial panel. A close match earns more coins. Your shop saves automatically.'
];
function updateTutorial() {
  if (!state) return;
  const step = state.tutorial;
  $('tutorial').hidden = isSandbox() || step >= TUTORIAL.length;
  $('tutorialText').textContent = (TUTORIAL[step] || '').replaceAll('60 ml', `${state.order.volume} ml`).replace('three times', state.order.volume === 60 ? 'three times' : state.order.volume === 80 ? 'four times' : 'five times');
}
function advanceTutorial() {
  if (!state || state.tutorial >= TUTORIAL.length) return;
  if (state.tutorial === 0 && brew.occupiedVolume > 0) state.tutorial = 1;
  if (state.tutorial === 1 && brew.liquidVolume >= state.order.volume - .1) state.tutorial = 2;
  if (state.tutorial === 2 && brew.history.stirred > .15) state.tutorial = 3;
  if (state.tutorial === 3 && brew.history.heatEnergy + brew.history.coldEnergy > .2) state.tutorial = 4;
  updateTutorial();
}
function pour(crushed = false) {
  if (!state || state.pendingBottle || state.stage !== 'brewing' || $('sheet').open) return;
  const ml = brew.pour(selected, dose, state.inventory, { crushed: crushed === true, infinite: isSandbox() });
  if (!ml) { stopPour(); notify(brew.occupiedVolume >= brew.capacity - 1 ? 'The cauldron is full. Bottle or clean it.' : 'This ingredient is depleted. Gather more in the Wild garden.'); return; }
  audio.play('pour'); renderRack(); updateHUD(); advanceTutorial(); persist();
}
function stopPour() { clearTimeout(holdTimer); clearInterval(holdInterval); holdTimer = holdInterval = 0; }
function thermal(kind) {
  if (!state || state.pendingBottle || state.stage !== 'brewing') return;
  if (!brew.engine.ps.count) { notify('Pour a reagent into the cauldron first.'); return; }
  if (state.equipment.furnace) {
    const current = kind === 'heat' ? brew.heat : brew.cool;
    sheet(kind === 'heat' ? 'Copper flame' : 'Frost chamber', `<p>Adjust the energy supplied to the brew. Temperature responds over time.</p><label class="setting-row">Power <input id="thermalPower" type="range" min="0" max="100" step="5" value="${Math.round(current * 100)}" data-thermal="${kind}" aria-label="Thermal power"></label><p id="thermalReadout">${Math.round(current * 100)}% power</p><button class="primary" data-action="close">Return to brewing</button>`);
    return;
  }
  const levels = [0, .35, .7, 1], current = kind === 'heat' ? brew.heat : brew.cool, next = levels[(levels.indexOf(current) + 1) % levels.length];
  brew.setThermal(kind === 'heat' ? next : 0, kind === 'cool' ? next : 0);
  audio.play(); renderTools(); persist();
}
function clean() {
  if (!brew.engine.ps.count) { notify('Your cauldron is already clean.'); return; }
  sheet('Clean the cauldron?', `<p>This drains ${Math.round(brew.occupiedVolume)} ml. Used ingredients cannot be recovered.</p><div class="confirm-actions"><button data-action="close">Keep brewing</button><button class="danger-button" data-action="confirm-clean">Drain and clean</button></div>`);
}
function measuredRows(sample, reveal = false) {
  const equipment = state.equipment;
  const visible = { color: true, temperature: true, density: equipment.densimeter, viscosity: equipment.viscometer, volatility: equipment.viscometer, stability: equipment.analyzer, potency: equipment.analyzer };
  const tools = { density: 'Density stone', viscosity: 'Flow glass', volatility: 'Flow glass', stability: 'Arcane prism', potency: 'Arcane prism' };
  return Object.entries(PROPERTIES).map(([property, spec]) => {
    if (EFFECT_PROPERTIES.includes(property)) return '';
    const unlocked = reveal || visible[property], value = sample[property];
    return `<div class="measure-row${unlocked ? '' : ' locked'}"><span class="measure-label">${spec.label}</span><span class="measure-value">${unlocked ? `${property === 'color' ? `<span class="inline-swatch" style="background:${escape(value)}"></span>` : ''}${escape(propertyDescription(property, value))}` : `Unlock ${tools[property]} at the guild`}</span></div>`;
  }).join('');
}
function effectRows(sample) {
  return `<div class="effects-grid">${EFFECT_PROPERTIES.map(key => {
    const spec = EFFECT_DEFINITIONS[key], value = Math.max(0, Math.min(1, Number(sample[key] || 0)));
    return `<div class="effect-reading" style="--effect-color:${spec.color}"><span>${escape(spec.label)}</span><strong>${Math.round(value * 100)}%</strong><div class="effect-meter"><span style="width:${value * 100}%"></span></div></div>`;
  }).join('')}</div>`;
}
function showInstruments() {
  if (!state) return;
  const sample = state.pendingBottle || brew.inspect();
  if (!sample) { sheet('Measuring bench', '<p>Pour an ingredient first. The thermometer and colour lens are ready; the guild can equip your bench with more instruments.</p><button class="primary" data-action="guild">Visit the guild</button>'); return; }
  latestInspection = { ...sample, portions: sample.portions || brew.portions.map(p => ({ ...p })) };
  if (state.tutorial >= 4 && state.tutorial < 6) { state.tutorial = 5; updateTutorial(); persist(); }
  audio.play('measure');
  sheet('Measuring bench', `<div class="vial-preview"><img src="${bottleSprite(sample.color)}" alt="Your measured potion"><div><h3>${Math.round(state.pendingBottle ? sample.volume : brew.liquidVolume)} ml in ${state.pendingBottle ? 'your vial' : 'the cauldron'}</h3><p>A careful measurement makes a better brew.</p></div></div>${measuredRows(sample)}<h3>Magic & chemistry</h3>${effectRows(sample)}<div class="snapshot-info">${Math.round(sample.liquidFraction * 100)}% liquid · ${Math.round(sample.history.elapsed)} seconds brewed · ${state.pendingBottle ? 'Sealed vial' : `${brew.vaporVolume.toFixed(1)} ml steam under the lid`} · ${(sample.history.condensed || 0).toFixed(1)} ml recondensed</div><button class="primary" data-action="experiments">Test this potion</button><button class="secondary" data-action="save-inspection">Save this discovery</button><details><summary>How do these measurements work?</summary><p>Physical, magical and chemical properties travel with the particles and mix on contact. Water dilutes all effects; crushed compatible ingredients dissolve gradually. Glowing particles hint at latent magic before a potion is used. A test dose reads the actual liquid and records how the subject responds. °A is the guild’s normalized temperature scale.</p></details>`);
}
function bottle() {
  if (state.stage === 'sale') { moveToNext(); return; }
  if (state.pendingBottle) { showVial(); return; }
  const vial = brew.bottle(isSandbox() ? dose : state.order.volume);
  state.pendingBottle = vial; state.stage = 'inspection';
  if (state.tutorial < 6) state.tutorial = 6;
  audio.play('measure'); renderAll(); persist(); showVial();
}
function breakdownHTML(result) {
  return `<div class="order-breakdown">${result.breakdown.map(row => `<div class="measure-row"><span class="measure-label">${PROPERTIES[row.property].label}</span><span class="measure-value">${escape(propertyDescription(row.property, row.actual))}<span class="target-note">Wanted: ${escape(propertyDescription(row.property, row.target))}${row.hard ? ' · required' : ''} · ${row.met ? 'within tolerance' : 'outside tolerance'}</span><span class="meter${row.met ? '' : ' fail'}"><span style="width:${Math.round(row.similarity * 100)}%"></span></span></span><strong>${Math.round(row.similarity * 100)}%</strong></div>`).join('')}</div>`;
}
function showVial() {
  const vial = state.pendingBottle; if (!vial) return;
  if (isSandbox()) {
    latestInspection = vial;
    sheet('Sandbox potion', `<div class="vial-preview"><img src="${bottleSprite(vial.color)}" alt="Bottled potion"><div><h3>${vial.volume.toFixed(1)} ml sealed vial</h3><p>Experiment freely and record your discoveries.</p></div></div>${effectRows(vial)}<button class="primary" data-action="experiments">Test a dose</button><button class="secondary" data-action="save-inspection">Save formula</button><button class="secondary" data-action="confirm-discard">Discard vial & keep brewing</button>`); return;
  }
  latestInspection = vial; const sale = priceSale(vial, state.order, state.reputation);
  const ingredientsCost = vial.cost.ingredients.toFixed(1);
  sheet('Your bottled potion', `<div class="vial-preview"><img src="${bottleSprite(vial.color)}" alt="Bottled potion"><div><div class="score">${Math.round(sale.quality)}<small> / 100 match</small></div><p>${vial.volume.toFixed(1)} / ${state.order.volume} ml · Sealed and ready</p><p>Expected offer: ${sale.payment} coins</p></div></div>${breakdownHTML(sale)}${effectRows(vial)}<p class="quiet">Reagents used: ${ingredientsCost} coins · Vial and energy: ${sale.expenses.toFixed(1)} coins. ${sale.quantityRatio < .99 ? 'A short vial lowers the offer.' : 'Extra volume never increases the customer’s budget.'}</p><button class="primary" data-action="sell">Sell to ${escape(state.order.customer.name)} · ${sale.payment} coins</button><button class="secondary" data-action="experiments">Test 5 ml before selling</button><button class="secondary" data-action="save-inspection">Save formula to recipe book</button><div class="action-list"><button class="danger-button" data-action="discard-vial">Discard vial and try again</button><button data-action="supplies">Visit supplies</button></div>`);
}
function sell() {
  completeSale(state); state.tutorial = 7;
  audio.play('sale'); renderAll(); persist(); showSale();
}
function showSale() {
  const sale = state.lastSale; if (!sale) return;
  latestInspection = sale.sample;
  sheet(sale.quality >= 90 ? 'A splendid commission' : sale.acceptable ? 'Commission complete' : 'A lesson in alchemy', `<div class="vial-preview"><img src="${portraitSprite(sale.customer.portraitSeed, sale.quality >= 90 ? 'happy' : sale.acceptable ? 'neutral' : 'sad')}" alt="${escape(sale.customer.name)}" style="width:64px;height:64px"><div><div class="score">${Math.round(sale.quality)}<small> / 100 quality</small></div><p>${escape(sale.customer.name)} · ${escape(sale.customer.role)}</p></div></div><p class="sale-dialogue">“${escape(sale.reaction)}”</p><div class="sale-coins">${icon('coin')}+${sale.payment}</div><div class="profit-line"><span>Profit after reagent, energy and vial costs</span><strong>${sale.profit >= 0 ? '+' : ''}${sale.profit.toFixed(1)}</strong></div><div class="profit-line"><span>Shop reputation</span><strong>${sale.reputationDelta >= 0 ? '+' : ''}${sale.reputationDelta}</strong></div>${sale.repayment ? `<p class="quiet">${sale.repayment} coins repaid to the guild.</p>` : ''}${breakdownHTML(sale)}<p class="progress-note">${state.completed === 1 ? 'The guild now offers a density stone. Spend your earnings to learn more about every brew.' : `You have completed ${state.completed} commissions. Visit the guild for new tools and reagents.`}</p><button class="primary" data-action="next">Welcome the next customer</button><button class="secondary" data-action="save-inspection">Remember this formula</button>`);
}
async function moveToNext() {
  const button = $('sheetContent').querySelector('[data-action="next"]'); if (button) button.disabled = true;
  await new Promise(resolve => setTimeout(resolve, 0));
  try { nextCustomer(state); $('orderClue').hidden = true; closeSheet(); renderAll(); persist(); notify(`${state.order.customer.name} has arrived.`); }
  catch (err) { if (button) button.disabled = false; notify(err.message); }
}
function showInventory() {
  const rows = availableIngredients(state.world, state.equipment).map(i => {
    const cost = Math.ceil(i.price * 60);
    const trade = Math.floor(i.price * 60 * .55);
    const tradeable = trade > 0 && !state.foraging.nodes.some(node => node.ingredientId === i.id && node.unlimited);
    return `<div class="stock-row"><img src="${ingredientSprite(i)}" alt=""><div class="stock-info"><strong>${escape(i.name)} · ${escape(i.form || 'liquid')}</strong><p>${isSandbox() ? 'Infinite' : Math.floor(state.inventory[i.id] || 0)} ${ingredientUnit(i)} in stock</p><p>${escape(i.lore)}</p>${!isSandbox() && tradeable ? `<button data-trade="${i.id}"${(state.inventory[i.id] || 0) < 60 ? ' disabled' : ''}>Trade 60 · +${trade} coins</button>` : ''}</div>${!isSandbox() ? `<button data-restock="${i.id}"${state.coins < cost ? ' disabled' : ''}>Buy 60<br>${cost} coins</button>` : ''}</div>`;
  }).join('');
  sheet('Ingredient supplies', `<p>${isSandbox() ? 'Every ingredient is unlimited. Grinding and pouring still use the same particle simulation.' : 'Gather ingredients for free in the Wild garden, or buy raw stock from the village.'} Each dry measure occupies 1 ml of cauldron capacity. Grind plants and stones, then stir a small amount into plenty of water.</p><button class="primary" data-action="nature">Go gathering</button>${rows}${!isSandbox() ? `<details><summary>Apprentice emergency fund</summary><p>If your total coins and remaining stock are worth less than 15 coins, the guild offers a 25 coin loan. You repay 30 coins from future sales. Only one loan can be outstanding.</p><button data-action="loan">Request guild loan</button><p>Outstanding debt: ${state.debt || 0} coins</p></details>` : ''}`);
}
function resourceText(status) {
  if (status.locked) return 'Requires a guild reagent unlock';
  if (status.unlimited || isSandbox()) return 'Infinite supply';
  const seconds = Math.max(0, Math.ceil((status.nextReadyAt - Date.now()) / 1000));
  return `${status.available} / ${status.capacity} ready${status.available < status.capacity ? ` · ${status.available ? 'regrowing' : `next in ${seconds}s`}` : ' · fully grown'}`;
}
function showNature() {
  const nodes = state.foraging.nodes;
  const rows = nodes.map(node => {
    const ingredient = state.world.ingredients.find(i => i.id === node.ingredientId), status = resourceStatus(state, node.id);
    return `<article class="resource-card"><img src="${ingredientSprite(ingredient)}" alt=""><div><strong>${escape(node.name)}</strong><p>${escape(ingredient.name)} · ${escape(node.biome)}</p><p class="resource-status" data-resource-status="${node.id}">${escape(resourceText(status))}</p><div class="resource-meter"><span data-resource-fill="${node.id}" style="width:${status.unlimited ? 100 : 100 * status.stock / status.capacity}%"></span></div></div><div class="resource-actions"><button data-gather="${node.id}"${status.locked || !status.available ? ' disabled' : ''}>Gather ${status.unlimited || isSandbox() ? 20 : Math.min(20, status.available)}</button><button data-gather-all="${node.id}"${status.locked || !status.available ? ' disabled' : ''}>${status.unlimited || isSandbox() ? 'Fill 60' : 'Gather all'}</button></div></article>`;
  }).join('');
  sheet('Wild garden', `<p class="room-intro">A stream, a woodland and a rocky clearing. Pick what you need; depleted patches recover with time, even while you are away.</p><div class="natural-scene"><img src="${naturalLandscapeSprite(state.seed)}" alt="A pixel-art woodland with a stream, flowers, mushrooms and mineral deposits">${nodes.map(node => `<button class="gather-hotspot" data-gather="${node.id}" style="left:${Math.max(6, Math.min(94, node.x * 100))}%;top:${Math.max(10, Math.min(90, node.y * 100))}%" aria-label="Gather ${escape(node.name)}"><img src="${ingredientSprite(state.world.ingredients.find(i => i.id === node.ingredientId))}" alt=""></button>`).join('')}</div><p class="quiet">Plants return as new growth. Stones become available as new deposits emerge. Plain water is always available.</p><div class="resource-list">${rows}</div><button class="primary" data-action="close">Return to brewing</button>`);
  currentRoom = 'nature';
  roomTimer = setInterval(updateNature, 1000);
}
function updateNature() {
  if (currentRoom !== 'nature' || !$('sheet').open) return;
  for (const node of state.foraging.nodes) {
    const status = resourceStatus(state, node.id);
    const label = $('sheetContent').querySelector(`[data-resource-status="${node.id}"]`);
    if (label) label.textContent = resourceText(status);
    const fill = $('sheetContent').querySelector(`[data-resource-fill="${node.id}"]`);
    if (fill) fill.style.width = `${status.unlimited || isSandbox() ? 100 : 100 * status.stock / status.capacity}%`;
    for (const button of $('sheetContent').querySelectorAll(`[data-gather="${node.id}"], [data-gather-all="${node.id}"]`)) {
      button.disabled = status.locked || !status.available;
      if (button.closest('.resource-actions') && button.dataset.gather) button.textContent = `Gather ${status.unlimited || isSandbox() ? 20 : Math.min(20, status.available)}`;
    }
  }
}
function gather(nodeId, all = false) {
  const status = resourceStatus(state, nodeId);
  const quantity = all && !status.unlimited && !isSandbox() ? status.available : all ? 60 : Math.min(20, status.available);
  const result = gatherIngredient(state, nodeId, quantity);
  renderRack(); persist(); updateNature(); audio.play();
  notify(`Gathered ${result.quantity} ${ingredientUnit(state.world.ingredients.find(i => i.id === result.ingredientId))}.`);
}
function subjectAppearance(subject) {
  const stats = subject.stats;
  if (!stats.alive) return 'dead';
  if (stats.burning > 2) return 'burning';
  if (stats.freezing > 2) return 'frozen';
  if (stats.transformation > 2) return 'transformed';
  if (stats.health < 65) return 'hurt';
  if (stats.love > 2) return 'loved';
  if (stats.strength > (subject.id === 'beetle' ? 37 : 22)) return 'strong';
  return 'healthy';
}
function showExperiments() {
  const available = state.pendingBottle?.volume || brew.liquidVolume, report = experimentReport;
  const cards = Object.values(state.experiments.subjects).map(subject => `<article class="subject-card"><img src="${experimentSubjectSprite(subject.id, subjectAppearance(subject))}" alt="${escape(subject.name)}, ${subjectAppearance(subject)}"><h3>${escape(subject.name)}</h3><p>${escape(subject.description)}</p><p class="subject-stats">${subject.stats.alive ? `Vitality ${Math.round(subject.stats.health)}%` : 'Life extinguished'}${subject.kind === 'plant' ? ` · Growth ${Math.round(subject.stats.growth)}%` : ''} · ${subject.trials} trials</p><button data-test="${subject.id}"${available < 1 || !subject.stats.alive ? ' disabled' : ''}>Test ${Math.min(5, available).toFixed(available < 5 ? 1 : 0)} ml</button><button class="reset-subject" data-reset-subject="${subject.id}">Reset subject</button></article>`).join('');
  const observedChanges = report ? Object.entries({ health: 'Health', vitality: 'Energy', growth: 'Growth', strength: 'Strength', love: 'Affection', transformation: 'Transformation', burning: 'Fire aura', freezing: 'Frost' }).filter(([key]) => Math.abs(report.after[key] - report.before[key]) > .05).map(([key, label]) => `<div class="observed-change"><span>${label}</span><strong>${report.before[key].toFixed(1)} → ${report.after[key].toFixed(1)}</strong></div>`).join('') : '';
  const reportHTML = report ? `<section id="experimentReport" class="experiment-report" role="status"><div class="eyebrow">TRIAL ${report.serial} · ${report.volume.toFixed(1)} ML</div><h3>${escape(report.subjectName)}</h3><ul>${report.observations.map(line => `<li>${escape(line)}</li>`).join('')}</ul>${observedChanges}${effectRows(report.sample)}<p>${report.safe ? 'No harmful response observed at this dose.' : 'Harmful effects observed. Review the composition before serving.'}</p></section>` : '<p id="experimentReport" class="empty-note">Choose a subject to observe a measured dose. Reset a subject to compare potions from the same starting condition.</p>';
  sheet('Experiments room', `<p class="room-intro">Try your potion on an animal, a plant or a mineral before selling. Each test uses real liquid from your ${state.pendingBottle ? 'sealed vial' : 'cauldron'}.</p><div class="experiment-supply">${available.toFixed(1)} ml available · ${state.pendingBottle ? 'Testing reduces the vial’s sale quantity' : 'Brew a little extra for your tests'}</div><div class="subjects-grid">${cards}</div>${reportHTML}${state.experiments.records.length ? `<details><summary>Observation journal · ${state.experiments.records.length} trials</summary>${state.experiments.records.slice(0, 8).map(record => `<p><strong>${escape(record.subjectName)}</strong> · ${record.volume.toFixed(1)} ml · ${escape(record.observations.join(' '))}</p>`).join('')}</details>` : ''}<button class="primary" data-action="${state.pendingBottle ? 'review-vial' : 'close'}">${state.pendingBottle ? 'Return to vial' : 'Return to brewing'}</button>`);
  currentRoom = 'experiments';
}
function testPotion(subjectId) {
  const subject = state.experiments.subjects[subjectId];
  if (!subject?.stats.alive) throw new Error('Reset this subject before another experiment.');
  let sample;
  if (state.pendingBottle) {
    const split = splitPotionSample(state.pendingBottle, 5);
    experimentReport = runExperiment(state, split.dose, subjectId, split.dose.volume);
    state.pendingBottle = split.remaining;
    if (!split.remaining) state.stage = 'brewing';
  } else {
    if (brew.liquidVolume < 1) throw new Error('Add water and dissolve ground ingredients before testing.');
    sample = brew.takeSample(5);
    experimentReport = runExperiment(state, sample, subjectId, sample.volume);
  }
  audio.play('measure'); renderAll(); persist(); showExperiments();
  requestAnimationFrame(() => {
    const result = $('experimentReport');
    if (currentRoom !== 'experiments' || !result) return;
    result.tabIndex = -1;
    result.focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  });
}
function showGuild() {
  if (isSandbox()) { sheet('Sandbox instruments', '<p>Every instrument, the master cauldron, furnace and rare ingredient are already unlocked. Use the measuring bench or experiment freely.</p><button class="primary" data-action="close">Return to brewing</button>'); return; }
  const rows = UPGRADES.map((u, index) => {
    const status = upgradeStatus(state, u);
    return `<div class="upgrade-row">${icon(u.id === 'reagents' ? 'vial' : u.id === 'furnace' ? 'flame' : u.id === 'cauldron' ? 'inventory' : 'measure')}<div class="upgrade-info"><strong>${u.name}</strong><p>${u.description}</p><small>${status.owned ? 'Owned' : !status.available ? `Requires ${u.sales} commissions${u.level > 1 ? ' and the previous upgrade' : ''}` : 'Ready to unlock'}</small></div><button data-upgrade="${index}"${!status.available || !status.affordable ? ' disabled' : ''}>${status.owned ? 'Owned' : `${u.cost}<br>coins`}</button></div>`;
  }).join('');
  sheet('Alchemists’ guild', `<p>${Math.floor(state.coins)} coins · ${state.completed} commissions · Reputation ${state.reputation}</p><p class="quiet">Buy instruments to discover hidden measurements. Shop improvements and reagents open as you complete more commissions.</p>${rows}`);
}
function showBook() {
  const rows = state.discoveries.map((d, index) => {
    const sample = d.sample;
    const portions = sample.portions || [];
    const grouped = new Map();
    for (const p of portions) {
      const key = `${p.ingredientId}:${Boolean(p.crushed)}`, prior = grouped.get(key);
      grouped.set(key, { ...p, ml: (prior?.ml || 0) + p.ml });
    }
    return `<div class="recipe-row"><img src="${bottleSprite(sample.color)}" alt=""><div class="recipe-info"><strong>${escape(d.name)}</strong><p>${Math.round(sample.volume)} ml · ${escape(propertyDescription('color', sample.color))} · ${escape(propertyDescription('temperature', sample.temperature))}</p><ul>${[...grouped.values()].map(p => {
      const ingredient = state.world.ingredients.find(i => i.id === p.ingredientId);
      return `<li>${p.ml.toFixed(1)} ${ingredient ? ingredientUnit(ingredient) : 'ml'} ${escape(ingredient?.name || 'reacted ingredient')}${p.crushed ? ' · ground' : ''}</li>`;
    }).join('')}</ul><p>${Math.round(sample.history.elapsed)} s brewed · ${sample.history.heatEnergy.toFixed(1)} heat energy · ${sample.history.coldEnergy.toFixed(1)} frost energy · ${sample.history.stirred.toFixed(1)} stirring</p><button data-recipe="${index}">Read measurements</button>${portions.length ? `<button data-prepare="${index}">Prepare these portions</button>` : ''}</div></div>`;
  }).join('');
  sheet('Your recipe book', `<p>Keep discoveries from your own experiments. A recorded formula remembers the measured potion and its preparation.</p>${rows || '<p class="empty-note">The pages are waiting. Inspect a brew or bottle a potion, then save your first discovery.</p>'}<p class="quiet">Pouring a recorded formula only transfers its ingredients. Stir and control the temperature yourself; the engine determines the new result.</p>`);
}
function showDiscovery(sample) {
  latestInspection = sample;
  sheet('Record a discovery', `<p>Name this ${Math.round(sample.volume)} ml ${escape(propertyDescription('color', sample.color).toLowerCase())} brew.</p><input id="discoveryName" class="name-input" maxlength="40" placeholder="e.g. Moonlit travelling tonic" aria-label="Discovery name"><button class="primary" data-action="record-discovery">Write in recipe book</button>`);
}
function prepareRecipe(index) {
  if (state.pendingBottle || state.stage === 'sale' || brew.engine.ps.count) throw new Error('Finish your sale and clean the cauldron before preparing a formula.');
  const discovery = state.discoveries[index]; if (!discovery) throw new Error('Formula not found.');
  const grouped = new Map();
  for (const p of discovery.sample.portions || []) {
    const key = `${p.ingredientId}:${Boolean(p.crushed)}`, prior = grouped.get(key);
    grouped.set(key, { ingredientId: p.ingredientId, ml: (prior?.ml || 0) + p.ml, crushed: Boolean(p.crushed) });
  }
  const portions = [...grouped.values()].map(p => ({ ...p, ml: Math.round(p.ml) })).filter(p => p.ml > 0);
  const total = portions.reduce((n, p) => n + p.ml, 0);
  if (total > brew.capacity) throw new Error('This formula needs a larger cauldron.');
  const requiredStock = new Map();
  for (const p of portions) requiredStock.set(p.ingredientId, (requiredStock.get(p.ingredientId) || 0) + p.ml);
  for (const [ingredientId, ml] of requiredStock) if (!isSandbox() && (state.inventory[ingredientId] || 0) < ml) throw new Error('Gather the formula’s ingredients in the Wild garden first.');
  for (const p of portions) brew.pour(p.ingredientId, p.ml, state.inventory, { crushed: p.crushed, infinite: isSandbox() });
  closeSheet(); renderRack(); updateHUD(); persist(); notify('Portions poured. Stir and apply the recorded heat or frost.');
}
function showSettings() {
  sheet('Shop settings', `<label class="setting-row">Gentle sound effects<input id="soundSetting" type="checkbox"${state.settings.sound ? ' checked' : ''}></label><label class="setting-row">Graphics<select id="graphicsSetting"><option value="balanced"${state.settings.graphics === 'balanced' ? ' selected' : ''}>Crisp · balanced</option><option value="eco"${state.settings.graphics === 'eco' ? ' selected' : ''}>Low · battery saver</option></select></label><p class="quiet">Both presets use the same 2D physics and potion quantities. Battery saver renders at 30 frames per second with fewer glows. Crisp mode uses finer material pixels.</p><div class="action-list"><button data-action="export">Export save</button><button data-action="import">Import save</button><button data-action="tutorial">Replay tutorial</button><button data-action="menu">Main menu</button><a href="./sandbox.html?mode=2D">Original physics sandbox</a></div><input type="file" id="importSaveInput" accept="application/json,.json" class="hidden-input"><h3>How to brew</h3><ol class="help-list"><li>Read the request. Ask for a clue if needed.</li><li>Gather plants, mushrooms and stones in the Wild garden. Depleted patches regrow over time.</li><li>Start with plain water. Select a raw ingredient and Grind & add, or add it whole and crush it with the Pestle inside the cauldron.</li><li>Use at least six parts water for one part ground ingredient to dissolve it. Hold Stir or drag through the brew. Less water makes thick liquid dough when kneaded; untouched dry grains remain solid.</li><li>Flame and Frost change energy and phases. Particle glows hint at strength, love, death, transformation, fire and freezing magic.</li><li>Inspect magic and chemistry. Test a 5 ml dose on a subject in the Experiments room; the dose consumes actual potion.</li><li>Bottle liquid after trapped steam condenses. Sell the vial and save useful formulas. Sandbox offers infinite resources and saves separately.</li></ol><details><summary>Save and simulation details</summary><p>The world, stock, resource recovery, experiments, vial and full cauldron save on this browser. Panels pause brewing while you read; natural resources continue recovering with time. Temperature, phases and particle properties are restored. A frozen coherent body is rebuilt on load. Export your save before clearing browser data.</p></details>`);
}
function exportSave() {
  const blob = new Blob([encodeSave(state, brew)], { type: 'application/json' }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = isSandbox() ? 'alchemists-sandbox-save.json' : 'alchemists-shop-save.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Shop save exported.');
}

function bindUI() {
  $('newWorldBtn').onclick = startNew; $('continueBtn').onclick = () => openWorld(loaded.state.seed, loaded.state);
  $('sandboxBtn').onclick = () => openWorld(sandboxLoaded?.state?.seed || $('worldSeed').value.trim() || randomSeed(), sandboxLoaded?.state || null, 'sandbox');
  $('shuffleSeed').onclick = () => { $('worldSeed').value = randomSeed(); audio.play(); };
  $('menuBtn').onclick = menu; $('settingsBtn').onclick = showSettings;
  $('clueBtn').onclick = () => { $('orderClue').hidden = !$('orderClue').hidden; };
  $('skipTutorial').onclick = () => { state.tutorial = 7; updateTutorial(); persist(); };
  $('measureBtn').onclick = guard(showInstruments); $('inventoryBtn').onclick = showInventory; $('bookBtn').onclick = showBook; $('upgradesBtn').onclick = showGuild;
  $('natureBtn').onclick = guard(showNature); $('experimentsBtn').onclick = guard(showExperiments);
  $('grindBtn').onclick = guard(() => pour(true));
  $('bottleBtn').onclick = guard(bottle); $('heatBtn').onclick = () => thermal('heat'); $('coolBtn').onclick = () => thermal('cool'); $('cleanBtn').onclick = clean;
  document.querySelectorAll('[data-dose]').forEach(button => { button.onclick = () => {
    dose = Number(button.dataset.dose); document.querySelectorAll('[data-dose]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); renderRack();
  }; });
  $('pourBtn').onpointerdown = event => {
    if (event.button !== 0) return; event.preventDefault(); $('pourBtn').setPointerCapture(event.pointerId);
    pour(); holdTimer = setTimeout(() => { holdInterval = setInterval(() => pour(), 240); }, 420);
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('pourBtn').addEventListener(event, stopPour);
  $('pourBtn').onclick = event => { if (event.detail === 0) pour(); };
  $('crushBtn').onclick = () => { tool = tool === 'pestle' ? 'spoon' : 'pestle'; assist = false; renderer.spoon = null; updateHUD(); };
  $('stirBtn').onpointerdown = event => { if (!state || state.pendingBottle || state.stage !== 'brewing') return; event.preventDefault(); $('stirBtn').setPointerCapture(event.pointerId); tool = 'spoon'; assist = true; audio.play(); updateHUD(); };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('stirBtn').addEventListener(event, () => { assist = false; if (renderer) renderer.spoon = null; updateHUD(); });
  $('stirBtn').onkeydown = event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); assist = true; } };
  $('stirBtn').onkeyup = () => { assist = false; renderer.spoon = null; };
  $('ingredientRack').onclick = event => {
    const button = event.target.closest('[data-ingredient]'); if (!button) return;
    selected = Number(button.dataset.ingredient); audio.play(); renderRack();
  };
  let dragged = null;
  $('ingredientRack').onpointerdown = event => {
    const button = event.target.closest('[data-ingredient]');
    if (button) dragged = { id: Number(button.dataset.ingredient), x: event.clientX, y: event.clientY };
  };
  window.addEventListener('pointerup', event => {
    if (!dragged || !brew) return; const drag = dragged; dragged = null;
    const r = $('labCanvas').getBoundingClientRect();
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 20 && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) { selected = drag.id; pour(); }
  });
  window.addEventListener('pointercancel', () => { dragged = null; assist = false; pointer = null; stopPour(); });
  $('labCanvas').onpointerdown = event => {
    if (!brew || state.pendingBottle || state.stage !== 'brewing') return;
    event.preventDefault(); $('labCanvas').setPointerCapture(event.pointerId);
    pointer = { id: event.pointerId, point: renderer.screenToWorld(event.clientX, event.clientY), time: performance.now() };
    if (tool === 'pestle') brew.crush(pointer.point);
    renderer.tool = tool; renderer.spoon = pointer.point;
  };
  $('labCanvas').onpointermove = event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const now = performance.now(), point = renderer.screenToWorld(event.clientX, event.clientY), dt = Math.max(.012, Math.min(.1, (now - pointer.time) / 1000));
    if (tool === 'pestle') brew.crush(point);
    else brew.stir(point, { x: (point.x - pointer.point.x) / dt, y: (point.y - pointer.point.y) / dt }, dt, pointer.point);
    renderer.tool = tool;
    renderer.spoon = point; pointer = { id: event.pointerId, point, time: now }; advanceTutorial();
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('labCanvas').addEventListener(event, () => { pointer = null; if (renderer) renderer.spoon = null; });
  $('labCanvas').onkeydown = event => {
    if (!brew || state.pendingBottle || state.stage !== 'brewing') return;
    if (event.code === 'Space') { event.preventDefault(); assist = true; }
    const velocities = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, 4], ArrowDown: [0, -4] };
    if (velocities[event.key]) { event.preventDefault(); const [x, y] = velocities[event.key]; brew.stir({ x: 0, y: -.8 }, { x, y }, .1); advanceTutorial(); }
  };
  $('labCanvas').onkeyup = event => { if (event.code === 'Space') assist = false; };
  $('sheetContent').onclick = guard(event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.gather) { gather(button.dataset.gather); return; }
    if (button.dataset.gatherAll) { gather(button.dataset.gatherAll, true); return; }
    if (button.dataset.test) { testPotion(button.dataset.test); return; }
    if (button.dataset.resetSubject) { resetExperimentSubject(state, button.dataset.resetSubject); experimentReport = null; persist(); showExperiments(); return; }
    if (button.dataset.restock) { const result = restock(state, Number(button.dataset.restock)); renderAll(); persist(); showInventory(); notify(`Refilled ${result.quantity} ml for ${result.cost} coins.`); return; }
    if (button.dataset.trade) { const result = tradeStock(state, Number(button.dataset.trade)); renderAll(); persist(); showInventory(); notify(`Traded ${result.quantity} ml for ${result.payment} coins.`); return; }
    if (button.dataset.upgrade) { const upgrade = buyUpgrade(state, Number(button.dataset.upgrade)); brew.equipment = state.equipment; audio.play('sale'); renderAll(); persist(); showGuild(); notify(`${upgrade.name} is ready.`); return; }
    if (button.dataset.recipe) {
      selectedRecipe = state.discoveries[Number(button.dataset.recipe)];
      sheet(selectedRecipe.name, `${measuredRows(selectedRecipe.sample, true)}<h3>Magic & chemistry</h3>${effectRows(selectedRecipe.sample)}<div class="snapshot-info">Peak temperature ${Math.round(selectedRecipe.sample.history.peakTemperature * 100)}°A · ${selectedRecipe.sample.history.evaporated.toFixed(1)} ml evaporated</div><button class="primary" data-action="book">Back to recipe book</button>`); return;
    }
    if (button.dataset.prepare) { prepareRecipe(Number(button.dataset.prepare)); return; }
    switch (button.dataset.action) {
      case 'close': closeSheet(); break;
      case 'confirm-new': openWorld($('worldSeed').value.trim() || randomSeed()); break;
      case 'confirm-clean': brew.clean(); closeSheet(); renderAll(); persist(); notify('Cauldron drained and cleaned.'); break;
      case 'sell': sell(); break;
      case 'discard-vial': sheet('Discard this vial?', '<p>The sealed potion and its ingredients will be lost. Your customer will wait while you brew another.</p><div class="confirm-actions"><button data-action="close">Keep the vial</button><button class="danger-button" data-action="confirm-discard">Discard and brew again</button></div>'); break;
      case 'confirm-discard': discardVial(state); if (state.tutorial === 6) state.tutorial = 5; closeSheet(); renderAll(); persist(); notify('Vial discarded. Your customer is still waiting.'); break;
      case 'supplies': showInventory(); break;
      case 'nature': showNature(); break;
      case 'experiments': showExperiments(); break;
      case 'review-vial': showVial(); break;
      case 'next': moveToNext(); break;
      case 'guild': showGuild(); break;
      case 'book': showBook(); break;
      case 'save-inspection': showDiscovery(latestInspection); break;
      case 'record-discovery': recordDiscovery(state, latestInspection, $('discoveryName').value); persist(); audio.play(); showBook(); notify('Discovery written in your recipe book.'); break;
      case 'loan': guildLoan(state); renderAll(); persist(); showInventory(); notify('25 coin guild loan received.'); break;
      case 'export': exportSave(); break;
      case 'import': $('importSaveInput').click(); break;
      case 'tutorial': state.tutorial = 0; closeSheet(); updateTutorial(); persist(); break;
      case 'menu': menu(); break;
    }
  });
  $('sheetContent').oninput = guard(event => {
    if (event.target.id === 'thermalPower') {
      const power = Number(event.target.value) / 100, kind = event.target.dataset.thermal;
      brew.setThermal(kind === 'heat' ? power : 0, kind === 'cool' ? power : 0);
      $('thermalReadout').textContent = `${Math.round(power * 100)}% power`; renderTools(); persist();
    }
  });
  $('sheetContent').onchange = async event => {
    try {
      if (event.target.id === 'soundSetting') { state.settings.sound = event.target.checked; audio.enabled = state.settings.sound; audio.play(); persist(); }
      if (event.target.id === 'graphicsSetting') { state.settings.graphics = event.target.value; renderer.setQuality(state.settings.graphics); persist(); }
      if (event.target.id === 'importSaveInput' && event.target.files[0]) {
        const file = event.target.files[0]; if (file.size > 4000000) throw new Error('This save is too large.');
        const saved = decodeSave(await file.text()); await openWorld(saved.seed, saved); notify('Shop save imported.');
      }
    } catch (err) { notify(err.message); }
  };
  $('sheet').addEventListener('close', () => { accumulator = 0; clearInterval(roomTimer); roomTimer = 0; currentRoom = null; });
  document.addEventListener('visibilitychange', () => { assist = false; pointer = null; stopPour(); if (document.hidden) persist(); accumulator = 0; last = performance.now(); });
  window.addEventListener('pagehide', persist);
  window.addEventListener('blur', () => { assist = false; pointer = null; stopPour(); });
}
function loop(now) {
  const elapsed = Math.min(.075, (now - last) / 1000); last = now;
  const active = state && inShop && !document.hidden && !$('sheet').open && state.stage === 'brewing';
  if (active) {
    if (state.settings.graphics === 'balanced') {
      const quality = adaptiveQuality.sample(elapsed * 1000);
      if (quality) { renderer.setQuality(quality === 'LOW' ? 'eco' : 'balanced'); renderer.graphics.effectsScale = adaptiveQuality.effectsScale; }
    }
    accumulator = Math.min(accumulator + elapsed, FIXED_STEP * 3);
    while (accumulator >= FIXED_STEP) {
      if (assist) { renderer.tool = 'spoon'; brew.assistStir(); const angle = brew.history.elapsed * 3.5; renderer.spoon = { x: Math.cos(angle) * 1.15, y: -.6 + Math.sin(angle) * .45 }; }
      brew.step(FIXED_STEP); accumulator -= FIXED_STEP;
    }
    if (now - lastAutosave > 8000) persist();
  } else accumulator = 0;
  if (inShop && renderer && now - lastRender >= (renderer.quality === 'eco' ? 32 : 16)) { renderer.render(); lastRender = now; }
  if (inShop && now - lastHUD > 200) { updateHUD(); if (active) advanceTutorial(); lastHUD = now; }
  requestAnimationFrame(loop);
}
function drawMenu() {
  const ctx = $('menuArt').getContext('2d'); ctx.drawImage(workshopBackground(), 0, 0);
  const rect = (x, y, w, h, colour) => { ctx.fillStyle = colour; ctx.fillRect(x, y, w, h); };
  rect(112, 129, 160, 63, '#211d2c'); rect(116, 129, 152, 54, '#916042'); rect(120, 129, 144, 38, '#292938');
  rect(125, 151, 134, 16, '#659c8c'); rect(125, 149, 134, 4, '#a2d4b4'); rect(125, 167, 134, 13, '#477f75');
  rect(104, 124, 176, 5, '#dfb374'); rect(108, 129, 168, 5, '#b17946'); rect(120, 184, 144, 9, '#50343b'); rect(123, 192, 14, 27, '#211d2c'); rect(247, 192, 14, 27, '#211d2c');
  rect(155, 201, 74, 11, '#e69a50'); rect(161, 199, 7, 15, '#ffd598'); rect(182, 196, 8, 18, '#ffc67a'); rect(212, 198, 6, 16, '#ffd598');
  for (const [x, y] of [[142, 132], [186, 140], [235, 127], [170, 97], [220, 102]]) { rect(x, y, 6, 6, '#a4d6b7'); rect(x + 2, y - 3, 2, 12, '#dceabc'); }
}
function boot() {
  drawMenu(); loaded = loadShop(localStorage);
  sandboxLoaded = loadShop(localStorage, SANDBOX_SAVE_KEY);
  $('worldSeed').value = loaded.state?.seed || randomSeed();
  $('continueBtn').disabled = !loaded.state;
  $('saveMessage').textContent = loaded.error || 'Your shop saves automatically on this device.';
  bindUI(); document.body.dataset.gameState = 'menu'; document.body.dataset.gameReady = 'true';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url)).catch(() => {});
  requestAnimationFrame(loop);
}
try { boot(); }
catch (err) {
  console.error(err); document.body.dataset.gameState = 'error';
  const message = document.createElement('p'); message.className = 'startup'; message.textContent = `Startup failed: ${err.message}. Please reload the shop.`; document.body.append(message);
}
