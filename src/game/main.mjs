import { TestingRenderer } from './TestingRenderer.mjs';
import { findPotionId, compilePotionId } from './potionId.mjs';
import { startNegotiation, counterOffer, acceptCustomerOffer, certificationCost, certifyPotion, certificateFor, advanceComplaints, resolveComplaint } from './commerce.mjs';
import { generateWorld, availableIngredients, seedNumber } from './world.mjs';
import { BrewingSession } from './brewing.mjs';
import { newShop, restock, tradeStock, discardVial, UPGRADES, upgradeStatus, buyUpgrade, completeSale, nextCustomer, recordDiscovery, guildLoan } from './economy.mjs';
import { assessPotion, priceSale } from './evaluation.mjs';
import { saveShop, loadShop, encodeSave, decodeSave, SANDBOX_SAVE_KEY } from './persistence.mjs';
import { propertyDescription } from './potion.mjs';
import { FIXED_STEP, PROPERTIES } from './contracts.mjs';
import { LaboratoryRenderer } from './LaboratoryRenderer.mjs';
import { icon, bottleSprite, ingredientSprite, naturalLandscapeSprite, experimentSubjectSprite, portraitSprite, workshopBackground } from './art.mjs';
import { resourceStatus, gatherIngredient, tendGarden, gardenStamina } from './gathering.mjs';
import { runExperiment, resetExperimentSubject, splitPotionSample } from './experiments.mjs';
import { EFFECT_DEFINITIONS, EFFECT_PROPERTIES, describeEffects } from './effects.mjs';
import { observedPotion, discoveryKnowledge } from './knowledge.mjs';
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
let testingRenderer = null, selectedSubject = 'rabbit', testDose = 5, showUntreated = false, harvest = null, lastClaims = 0;
let sandboxLoaded = null, roomTimer = 0, currentRoom = null, experimentReport = null;
const isSandbox = () => state?.mode === 'sandbox';
const rawIngredient = i => Boolean(i.form && !['liquid', 'powder'].includes(i.form));
const ingredientUnit = i => i.form && i.form !== 'liquid' ? 'measures' : 'ml';
const requirementDescription = r => r.comparison === 'maximum' ? `At most ${(r.target * 100).toFixed(1)}% · unwanted effect` : propertyDescription(r.property, r.target);

function notify(message) {
  const target = $('sheet').open && $('panelNotice') ? $('panelNotice') : $('toast');
  target.textContent = message; target.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; if ($('panelNotice')) $('panelNotice').hidden = true; }, 3200);
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
  clearInterval(roomTimer); roomTimer = 0; currentRoom = null; testingRenderer = null; harvest = null;
  assist = false; pointer = null; stopPour();
  $('sheetContent').innerHTML = `<header class="sheet-header"><h2 id="sheetTitle">${escape(title)}</h2><button class="icon-button" data-action="close" aria-label="Close panel">${icon('close')}</button></header><div class="sheet-body"><output id="panelNotice" class="panel-notice" role="status" hidden></output>${content}</div>${footer ? `<div class="sheet-footer">${footer}</div>` : ''}`;
  if (!$('sheet').open) $('sheet').showModal();
}
function closeSheet() { clearInterval(roomTimer); roomTimer = 0; currentRoom = null; testingRenderer = null; harvest = null; if ($('sheet').open) $('sheet').close(); }

async function openWorld(seed, saved = null, mode = 'shop') {
  $('newWorldBtn').disabled = true; $('continueBtn').disabled = true;
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const world = saved?.world || generateWorld(seed);
    const candidate = saved || newShop(world, { sandbox: mode === 'sandbox' });
    const session = new BrewingSession(world.ingredients, candidate.equipment);
    if (saved?.brew) session.restore(saved.brew);
    state = candidate; advanceComplaints(state); brew = session; selected = availableIngredients(world, state.equipment)[0].id; experimentReport = null;
    renderer = new LaboratoryRenderer($('labCanvas'), brew); renderer.setQuality(state.settings.graphics);
    audio.enabled = state.settings.sound;
    $('shop').insertBefore($('toast'), $('shop').querySelector('.shop-navigation'));
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
  $('menu').appendChild($('toast'));
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
  const requirementRow = r => `<div class="requirement${r.comparison === 'maximum' ? ' unwanted-effect' : ''}">${r.property === 'color' ? `<span class="colour-swatch" style="background:${escape(r.target)}"></span>` : icon(r.property === 'temperature' || r.property === 'fire' ? 'flame' : r.property === 'freeze' || r.property === 'stability' ? 'frost' : EFFECT_PROPERTIES.includes(r.property) || r.property === 'potency' ? 'star' : 'measure')}<div><span class="req-label">${PROPERTIES[r.property].label.toUpperCase()}${r.comparison === 'maximum' ? ' · LIMIT' : r.hard ? ' · REQUIRED' : ''}</span><span class="req-target">${escape(requirementDescription(r))}</span></div></div>`;
  const wanted = order.requirements.filter(r => r.comparison !== 'maximum'), limits = order.requirements.filter(r => r.comparison === 'maximum');
  $('requirements').innerHTML = wanted.map(requirementRow).join('') + (limits.length ? `<details class="order-limits"><summary>Unwanted effects · ${limits.length} limits</summary><div class="requirements">${limits.map(requirementRow).join('')}</div></details>` : '');
  $('orderClue').textContent = order.clue;
  for (const [id, sprite, label] of [['measureBtn', 'flask', 'Potion ID'], ['inventoryBtn', 'inventory', 'Ingredients'], ['bookBtn', 'book', 'Recipe book'], ['upgradesBtn', 'guild', 'Guild']]) $(id).innerHTML = icon(sprite) + `<span>${label}</span>`;
  $('natureBtn').innerHTML = `${icon('leaf')}<span>Garden</span>`;
  $('experimentsBtn').innerHTML = `${icon('flask')}<span>Trials</span>`;
  $('complaintsBtn').innerHTML = `${icon('coin')}<span>Returns ${(state.complaints || []).filter(c=>c.status==='pending').length || ''}</span>`;
  renderRack(); renderTools(); updateHUD(); updateTutorial();
  document.body.dataset.gameState = state.stage;
}
function renderRack() {
  const rack = $('ingredientRack'), scroll = rack.scrollLeft, ingredients = availableIngredients(state.world, state.equipment);
  rack.innerHTML = ingredients.map(i => `<button class="ingredient-card${i.id === selected ? ' selected' : ''}" data-ingredient="${i.id}" aria-label="Select ${escape(i.name)}, ${i.form || 'liquid'}" aria-pressed="${i.id === selected}"><img src="${ingredientSprite(i)}" alt=""><span>${escape(i.name)}</span><small>${escape(i.form || 'liquid')} · ${isSandbox() ? '∞' : Math.floor(state.inventory[i.id] || 0)} ${ingredientUnit(i)}</small><small class="ingredient-effects">${describeEffects(i.material).slice(0, 2).map(e => `${escape(e.label)} ${Math.round(e.value * 100)}%`).join(' · ') || 'Neutral solvent'}</small></button>`).join('');
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
  'Tap the customer for the request. Ingredient magic is known; mixture magic is yours to discover.',
  'Pour water. Leave a little extra for creature trials.',
  'Choose an essence. Grind plants and stones before adding them.',
  'Drag the wooden spoon or hold Stir. Gentle warmth helps reluctant essences blend.',
  'Open Trials. Watch a creature before and after a small dose.',
  'Write every magical estimate in the potion ID. Adjust, retest, then bottle.',
  'Bargain for a price. The expert seal protects this batch against false refund claims.'
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
  if (state.tutorial === 3 && brew.history.stirred > 1) state.tutorial = 4;
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
function effectRows(sample, knowledge = null) {
  const values = knowledge === true ? sample : knowledge?.estimates;
  if (!values) return '<p class="unknown-effects">No potion ID yet. Observe a creature trial and write your estimates.</p>';
  return `<div class="effects-grid">${EFFECT_PROPERTIES.map(key => `<div class="effect-reading" style="--effect-color:${EFFECT_DEFINITIONS[key].color}"><span>${EFFECT_DEFINITIONS[key].label}</span><strong>${Math.round((values[key]||0)*100)}%</strong><div class="effect-meter"><span style="width:${(values[key]||0)*100}%"></span></div></div>`).join('')}</div>`;
}
function showInstruments() { showPotionID(); }
function showPotionID() {
  const sample = state.pendingBottle || brew.inspectLiquid();
  if (!sample) { sheet('Potion ID','<p>Brew a potion, then test a spare dose on a familiar.</p><button class="primary" data-action="experiments">Creature trials</button>'); return; }
  latestInspection = sample;
  const document = findPotionId(state,sample), tested = observedPotion(state,sample);
  if (!tested) { sheet('Potion ID',`<div class="vial-preview"><img src="${bottleSprite(sample.color)}" alt="Potion"><p>This batch needs a creature trial.</p></div><button class="primary" data-action="experiments">Creature trials</button>`); return; }
  sheet('Write a potion ID',`<p>Your observations, your estimates. Compare doses and untreated creatures; the guild does not fill in the answers.</p><input id="potionName" class="name-input" aria-label="Potion name" maxlength="40" placeholder="Potion name" value="${escape(document?.name || '')}"><div class="estimate-carousel mini-pages">${EFFECT_PROPERTIES.map(key=>`<article class="mini-card estimate-card"><h3 style="color:${EFFECT_DEFINITIONS[key].color}">${EFFECT_DEFINITIONS[key].label}</h3><div class="estimate-glyph" style="color:${EFFECT_DEFINITIONS[key].color}">✧</div><label>My estimate <output data-estimate-value="${key}">${Math.round((document?.estimates[key]||0)*100)}%</output><input type="range" data-estimate="${key}" aria-label="Estimate ${EFFECT_DEFINITIONS[key].label}" min="0" max="100" step="1" value="${Math.round((document?.estimates[key]||0)*100)}"></label></article>`).join('')}</div><p class="swipe-cue">Swipe through all eight enchantments →</p><button class="primary" data-action="compile-id">Compile potion ID</button><button class="secondary" data-action="experiments">Observe another trial</button>`);
}

function bottle() {
  if (state.stage === 'sale') { moveToNext(); return; }
  if (state.pendingBottle) { showVial(); return; }
  const vial = brew.bottle(isSandbox() ? dose : state.order.volume);
  state.pendingBottle = vial; state.stage = 'inspection';
  if (state.tutorial < 6) state.tutorial = 6;
  audio.play('measure'); renderAll(); persist(); showVial();
}
function showVial() {
  const vial = state.pendingBottle; if (!vial) return;
  latestInspection = vial;
  const document = findPotionId(state,vial), seal = certificateFor(state,vial), cost = certificationCost(state);
  sheet('Sealed potion',`<div class="vial-preview"><img src="${bottleSprite(vial.color)}" alt="Bottled potion"><div><h3>${escape(document?.name || 'Unidentified potion')}</h3><p>${vial.volume.toFixed(1)} / ${state.order.volume} ml</p>${document?`<small>${escape(document.id)}</small>`:''}</div></div>${effectRows(vial,document)}${document?'<p class="quiet">Your written estimates. The customer will discover the real effects after using it.</p>':''}<div class="vial-actions"><button class="primary" data-action="${isSandbox()?'experiments':'sell'}"${!isSandbox()&&!document?' disabled':''}>${isSandbox()?'Creature trials':'Negotiate price'}</button><button class="secondary" data-action="potion-id">${document?'Edit potion ID':'Write potion ID'}</button><button class="secondary" data-action="experiments">Test a spare dose</button>${!isSandbox()?`<button data-action="certify"${seal||state.coins<cost||!document?' disabled':''}>${seal?'Expert seal attached':`Expert seal · ${cost} coins`}</button><p class="quiet">A seal applies only to this batch. It defeats false claims; genuine faults still require a refund.</p>`:''}<button data-action="save-inspection">Remember formula</button><button class="danger-button" data-action="discard-vial">Discard vial</button></div>`);
}
function showNegotiation() {
  const deal = startNegotiation(state); persist();
  sheet('At the counter',`<div class="vial-preview"><img style="width:56px;height:56px" src="${portraitSprite(state.order.customer.portraitSeed)}" alt="${escape(state.order.customer.name)}"><div><h3>${escape(state.order.customer.name)}</h3><p>${deal.agreed?'Agreed. I will try it at home.':deal.round>=4?'That is my final offer.':deal.round?'Could you meet me here?':'What price would you accept?'}</p></div></div><div class="sale-coins">${icon('coin')}${deal.offer}</div><p class="quiet">Customer offer · ${deal.round}/4 rounds</p>${deal.history.length?`<div class="deal-history">${deal.history.map(h=>`<span>You ${h.ask} ↔ ${h.offer}</span>`).join('')}</div>`:''}<label class="setting-row">Your price <input id="sellerPrice" type="number" inputmode="numeric" min="1" max="${state.order.budget*3}" value="${Math.min(state.order.budget,deal.offer+10)}"></label><button class="primary" data-action="accept-offer">${deal.agreed?'Seal the agreement':`Accept ${deal.offer} coins`}</button><button class="secondary" data-action="counter-offer"${deal.agreed||deal.round>=4?' disabled':''}>Make an offer</button><button data-action="review-vial">Back to vial</button>`);
}
function sell() { showNegotiation(); }
function finishAgreement() {
  acceptCustomerOffer(state); completeSale(state); state.tutorial = 7;
  audio.play('sale'); renderAll(); persist(); showSale();
}
function showSale() {
  const sale = state.lastSale; if (!sale) return;
  latestInspection = sale.sample;
  sheet('Potion delivered',`<div class="vial-preview"><img src="${portraitSprite(sale.customer.portraitSeed,'happy')}" style="width:60px;height:60px" alt="${escape(sale.customer.name)}"><p>“Thank you. I will try this at home.”</p></div><div class="sale-coins">${icon('coin')}+${sale.payment}</div><p class="quiet">Agreed payment. A disappointed customer may return later; keep the receipt and the potion ID.</p><div class="profit-line"><span>Brewing margin</span><strong>${sale.profit.toFixed(1)}</strong></div><button class="primary" data-action="next">Next customer</button><button class="secondary" data-action="save-inspection">Remember formula</button><button data-action="returns">Receipts & returns</button>`);
}
function showReturns() {
  advanceComplaints(state); persist();
  const claims = (state.complaints || []).filter(c=>c.status==='pending');
  sheet('Receipts & returns',`<p>Refunds are binding. Unpaid amounts become guild debt. A matching expert seal can contest a false claim.</p><div class="mini-pages">${claims.map(c=>`<article class="mini-card"><img class="return-portrait" src="${portraitSprite(c.customer.portraitSeed,'sad')}" alt="${escape(c.customer.name)}"><h3>${escape(c.customer.name)}</h3><p>“${escape(c.reason)}”</p><div class="sale-coins">${c.payment} ${icon('coin')}</div><button class="primary" data-refund="${c.id}">Refund ${c.payment}</button>${c.certified?`<button class="secondary" data-contest="${c.id}">Present this batch's seal</button>`:''}<p class="quiet">The guild settles this claim in ${Math.max(0,Math.ceil((c.deadline-Date.now())/1000))}s.</p></article>`).join('')||'<article class="mini-card"><h3>No returning customers</h3><p>Customers use their potions at home before reporting back.</p></article>'}${(state.deliveries||[]).slice(0,12).map(r=>`<article class="mini-card"><h3>${escape(r.customer.name)}</h3><p>${r.payment} coins · ${r.certified?'Expert seal':'Uncertified'}</p><p class="quiet">${escape(r.potionId||'Legacy potion')}<br>${escape((state.complaints||[]).find(c=>c.orderId===r.orderId)?.status || r.status)}</p></article>`).join('')}</div><p class="swipe-cue">Swipe receipts →</p>`);
}
function showOrder() {
  sheet(`${state.order.customer.name}'s request`,`<p class="sale-dialogue">“${escape(state.order.customer.dialogue)}”</p><p>${state.order.volume} ml · budget ${state.order.budget} coins</p><div class="mini-pages">${state.order.requirements.map(r=>`<article class="mini-card"><h3>${PROPERTIES[r.property].label}</h3><div class="estimate-glyph">✧</div><p>${r.comparison==='maximum'?`At most ${(r.target*100).toFixed(1)}%`:`${Math.max(0,(r.target-r.tolerance)*100).toFixed(1)}–${Math.min(100,(r.target+r.tolerance)*100).toFixed(1)}%`}</p><p class="quiet">${r.comparison==='maximum'?'Unwanted enchantment':'Desired enchantment'}</p></article>`).join('')}</div><p class="swipe-cue">Swipe through the request →</p>`);
}

async function moveToNext() {
  const button = $('sheetContent').querySelector('[data-action="next"]'); if (button) button.disabled = true;
  await new Promise(resolve => setTimeout(resolve, 0));
  try { nextCustomer(state); $('orderClue').hidden = true; closeSheet(); renderAll(); persist(); notify(`${state.order.customer.name} has arrived.`); }
  catch (err) { if (button) button.disabled = false; notify(err.message); }
}
function showInventory() {
  const rows = availableIngredients(state.world,state.equipment).map(i=>`<article class="mini-card stock-card"><img src="${ingredientSprite(i)}" alt=""><h3>${escape(i.name)}</h3><p>${isSandbox()?'∞':Math.floor(state.inventory[i.id]||0)} ${ingredientUnit(i)}</p><p>${escape(i.lore)}</p>${effectRows(i.material,true)}<p class="quiet">Awakening rune: ${i.material.arcaneThreshold < 0?'deep frost':i.material.arcaneThreshold>1.2?'distant flame':Math.round(i.material.arcaneThreshold*100)+'°A'}. Blending changes the rune.</p><button class="primary" data-garden-node="${state.foraging.nodes.find(n=>n.ingredientId===i.id)?.id}">Visit garden bed</button>${!isSandbox()?`<button data-restock="${i.id}">Village parcel · 20 · ${i.solvent?0:Math.ceil(i.price*100+8)} coins</button>`:''}</article>`).join('');
  sheet('Known ingredients',`<div class="mini-pages">${rows}</div><p class="swipe-cue">Swipe ingredients →</p>${!isSandbox()?'<button data-action="loan">Emergency guild loan</button>':''}`);
}
function resourceText(status) {
  if (status.locked) return 'Guild bed · locked';
  if (status.unlimited) return 'Fresh spring water';
  const seconds=Math.max(0,Math.ceil((status.nextReadyAt-Date.now())/1000));
  return `${status.available}/${status.capacity} ripe${status.depleted?` · wait ${Math.ceil(seconds/60)}m`:''}`;
}
function showNature(nodeId = null) {
  const nodes=state.foraging.nodes;
  sheet('Your garden',`<div class="garden-summary">Stamina <strong id="gardenStamina">${Math.floor(gardenStamina(state))}</strong>/100 · Jars hold ${state.equipment.viscometer?96:72} measures</div><div class="natural-scene"><img src="${naturalLandscapeSprite(state.seed)}" alt="Your magical garden">${nodes.map(n=>`<button class="gather-hotspot" data-garden-node="${n.id}" style="left:${n.x*100}%;top:${n.y*100}%" aria-label="Visit ${escape(n.name)}"><img src="${ingredientSprite(state.world.ingredients.find(i=>i.id===n.ingredientId))}" alt=""></button>`).join('')}</div><div class="mini-pages resource-list">${nodes.map(n=>{const i=state.world.ingredients.find(i=>i.id===n.ingredientId),status=resourceStatus(state,n.id);return `<article class="mini-card resource-card" data-bed="${n.id}"><img src="${ingredientSprite(i)}" alt=""><h3>${escape(n.name)}</h3><p>${escape(i.name)}</p><p data-resource-status="${n.id}">${resourceText(status)}</p><div class="resource-meter"><span data-resource-fill="${n.id}" style="width:${status.unlimited?100:status.stock/status.capacity*100}%"></span></div><button class="primary" data-gather="${n.id}"${status.locked||status.depleted||!status.unlimited&&status.stamina<(state.equipment.viscometer?9:12)?' disabled':''}>${status.unlimited?'Collect 20 ml':'Harvest · ${state.equipment.viscometer?9:12} stamina'}</button>${status.unlimited?'':`<button data-tend="${n.id}"${status.locked||status.tendedUntil>Date.now()?' disabled':''}>Tend · 5 water · 6 stamina</button>`}</article>`;}).join('')}</div><p class="swipe-cue">Swipe beds →</p>`);
  currentRoom='nature';roomTimer=setInterval(updateNature,1000);
  if(nodeId) requestAnimationFrame(()=>$('sheetContent').querySelector(`[data-bed="${nodeId}"]`)?.scrollIntoView({block:'nearest',inline:'start'}));
}
function updateNature() {
  if(currentRoom!=='nature')return;
  $('gardenStamina').textContent=Math.floor(gardenStamina(state));
  for(const node of state.foraging.nodes){const status=resourceStatus(state,node.id);const label=$('sheetContent').querySelector(`[data-resource-status="${node.id}"]`);if(label)label.textContent=resourceText(status);const fill=$('sheetContent').querySelector(`[data-resource-fill="${node.id}"]`);if(fill)fill.style.width=`${status.unlimited?100:status.stock/status.capacity*100}%`;const button=$('sheetContent').querySelector(`[data-gather="${node.id}"]`);if(button)button.disabled=status.locked||status.depleted||!status.unlimited&&status.stamina<(state.equipment.viscometer?9:12);}
}
function startHarvest(nodeId) {
  const status=resourceStatus(state,nodeId);
  if(status.unlimited){const result=gatherIngredient(state,nodeId,20);renderRack();persist();updateNature();notify(`Collected ${result.quantity} ml.`);return;}
  if(status.locked||status.depleted||status.stamina<(state.equipment.viscometer?9:12))throw new Error('This bed is not ready to harvest.');
  const target=.24+(seedNumber(`${state.seed}:${nodeId}:${status.harvests||0}`)%51)/100;
  sheet('A careful harvest',`<img class="harvest-icon" src="${ingredientSprite(state.world.ingredients.find(i=>i.id===status.ingredientId))}" alt="Ingredient"><p>Tap Harvest when the marker crosses the green band. Careful timing saves more of the crop.</p><div class="harvest-meter"><span class="harvest-target" style="left:${(target-.1)*100}%;width:20%"></span><span id="harvestMarker"></span></div><button class="primary" data-action="harvest">Harvest</button><button data-action="nature">Leave it growing</button>`);
  harvest={nodeId,target,start:performance.now(),position:0};currentRoom='harvest';
}
function finishHarvest() {
  if(!harvest)return;
  const {nodeId,target,position}=harvest;
  const precision=Math.max(0,1-Math.abs(position-target)/.35);
  const result=gatherIngredient(state,nodeId,10,Date.now(),{precision});
  renderRack();persist();audio.play();showNature(nodeId);notify(`Harvested ${result.quantity}${result.wasted?` · ${result.wasted} lost`:''}.`);
}
function showExperiments() {
  const subject=state.experiments.subjects[selectedSubject],report=state.experiments.records.find(r=>r.subjectId===selectedSubject);
  const available=state.pendingBottle?.volume || brew.liquidVolume;
  sheet('Creature trials',`<div class="subject-selector">${Object.values(state.experiments.subjects).map(c=>`<button data-subject="${c.id}" class="${c.id===selectedSubject?'active':''}"><img src="${experimentSubjectSprite(c.id,'healthy')}" alt=""><span>${escape(c.name)}</span></button>`).join('')}</div><canvas id="creatureCanvas" width="320" height="176" aria-label="Creature enclosure, visual potion response"></canvas><div id="experimentReport" class="trial-controls"><button data-action="untreated" aria-pressed="${showUntreated}">${showUntreated?'Observe response':'Untreated view'}</button><label>Dose <select id="trialDose">${[2,5,10].map(v=>`<option value="${v}"${testDose===v?' selected':''}>${v} ml</option>`).join('')}</select></label><button data-test="${subject.id}"${available<1||!subject.stats.alive||subject.readyAt>Date.now()?' disabled':''}>Give dose</button><button data-reset-subject="${subject.id}">Fresh trial · ${isSandbox()?0:state.equipment.densimeter?1:3} coins</button></div><p class="quiet">${available.toFixed(1)} ml available · ${subject.trials} trials · ${report?`${report.volume.toFixed(1)} ml last dose`:'Untreated'}${subject.readyAt>Date.now()?' · resting':''}</p><div class="action-list"><button class="primary" data-action="potion-id"${!observedPotion(state,state.pendingBottle||brew.inspectLiquid())?' disabled':''}>Write potion ID</button><button class="secondary" data-action="${state.pendingBottle?'review-vial':'close'}">${state.pendingBottle?'Back to vial':'Back to brewing'}</button></div>`);
  currentRoom='experiments';testingRenderer=new TestingRenderer($('creatureCanvas'));
  roomTimer=setInterval(()=>{if(currentRoom==='experiments'){const c=state.experiments.subjects[selectedSubject],b=$('sheetContent').querySelector('[data-test]');if(b)b.disabled=!(state.pendingBottle?.volume||brew.liquidVolume)||!c.stats.alive||c.readyAt>Date.now();}},1000);
}
function testPotion(subjectId) {
  const subject=state.experiments.subjects[subjectId];
  if(!subject?.stats.alive||subject.readyAt>Date.now())throw new Error('Prepare a fresh trial or let this familiar rest.');
  const preparation=structuredClone(state.pendingBottle||brew.inspectLiquid());
  if(state.pendingBottle){const split=splitPotionSample(state.pendingBottle,testDose);experimentReport=runExperiment(state,split.dose,subjectId,split.dose.volume,Date.now(),preparation);state.pendingBottle=split.remaining;if(!split.remaining)state.stage='brewing';}
  else {if(brew.liquidVolume<1)throw new Error('Prepare a liquid potion first.');const sample=brew.takeSample(testDose);experimentReport=runExperiment(state,sample,subjectId,sample.volume,Date.now(),preparation);}
  state.negotiation=null;latestInspection=preparation;selectedSubject=subjectId;showUntreated=false;
  if(state.tutorial<5)state.tutorial=5;
  audio.play('measure');renderAll();persist();showExperiments();
}

function showGuild() {
  const rows=UPGRADES.map((u,index)=>{const status=upgradeStatus(state,u);return `<article class="mini-card"><h3>${u.name}</h3><p>${u.description}</p><p class="quiet">${status.owned?'Owned':!status.available?`Requires ${u.sales} commissions`:'Ready'}</p><button class="primary" data-upgrade="${index}"${!status.available||!status.affordable||isSandbox()?' disabled':''}>${status.owned?'Owned':`${u.cost} coins`}</button></article>`;}).join('');
  sheet('Alchemists’ guild',`<p>${Math.floor(state.coins)} coins · ${state.completed} commissions</p><div class="mini-pages">${rows}</div><p class="swipe-cue">Swipe improvements →</p><button class="secondary" data-action="review-vial"${!state.pendingBottle?' disabled':''}>Expert certification · sealed batch</button>`);
}
function showBook() {
  sheet('Formula book',`<div class="mini-pages">${state.discoveries.map((d,index)=>`<article class="mini-card"><img class="book-vial" src="${bottleSprite(d.sample.color)}" alt=""><h3>${escape(d.name)}</h3><p class="quiet">${d.potionId?'Player estimates recorded':'No written estimates'}</p>${effectRows(d.sample,d.potionId)}<ul class="formula-portions">${(d.preparation?.portions||d.sample.portions||[]).map(p=>`<li>${p.ml.toFixed(1)} ${escape(state.world.ingredients.find(i=>i.id===p.ingredientId)?.name||'Essence')}${p.crushed?' · ground':''}</li>`).join('')}</ul><button data-prepare="${index}">Prepare portions</button></article>`).join('')||'<article class="mini-card"><h3>Your first formula</h3><p>Bottle a potion, compile its ID, then remember the formula.</p></article>'}</div><p class="swipe-cue">Swipe formulas →</p>`);
}

function showDiscovery(sample) {
  latestInspection = sample;
  sheet('Record a discovery', `<p>${observedPotion(state, sample) ? 'Tested discovery. Name this' : 'Untested formula: its effects remain unknown. Name this'} ${Math.round(sample.volume)} ml ${escape(propertyDescription('color', sample.color).toLowerCase())} brew.</p><input id="discoveryName" class="name-input" maxlength="40" placeholder="e.g. Moonlit travelling tonic" aria-label="Discovery name"><button class="primary" data-action="record-discovery">Write in recipe book</button>`);
}
function prepareRecipe(index) {
  if (state.pendingBottle || state.stage === 'sale' || brew.engine.ps.count) throw new Error('Finish your sale and clean the cauldron before preparing a formula.');
  const discovery = state.discoveries[index]; if (!discovery) throw new Error('Formula not found.');
  const grouped = new Map();
  for (const p of discovery.preparation?.portions || discovery.sample.portions || []) {
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
  sheet('Settings',`<label class="setting-row">Sound<input id="soundSetting" type="checkbox"${state.settings.sound?' checked':''}></label><label class="setting-row">Graphics<select id="graphicsSetting"><option value="balanced"${state.settings.graphics==='balanced'?' selected':''}>Balanced</option><option value="eco"${state.settings.graphics==='eco'?' selected':''}>Battery saver</option></select></label><div class="action-list"><button data-action="export">Export save</button><button data-action="import">Import save</button><button data-action="tutorial">Tutorial</button><button data-action="menu">Main menu</button></div><input type="file" id="importSaveInput" accept="application/json,.json" class="hidden-input"><details><summary>Brewing guide</summary><p>Grind dry ingredients and stir with water. Gentle warmth helps separate essences blend; too much heat destroys magic. Opposed awakening runes can average into a reachable temperature and turn one enchantment overwhelming. Watch all creature responses, compare doses, and write a potion ID. Negotiate a price; refund real faults. An expensive expert seal protects the specific batch against false claims. Garden beds regrow while you are away, with limited harvests and stamina.</p></details>`);
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
  $('clueBtn').onclick = showOrder; $('customerDetailsBtn').onclick = showOrder; $('complaintsBtn').onclick = showReturns;
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
    if (button.dataset.gardenNode) { showNature(button.dataset.gardenNode); return; }
    if (button.dataset.tend) { tendGarden(state,button.dataset.tend); persist(); renderRack(); showNature(button.dataset.tend); return; }
    if (button.dataset.subject) { selectedSubject=button.dataset.subject;showUntreated=false;showExperiments();return; }
    if (button.dataset.refund || button.dataset.contest) { const claim=resolveComplaint(state,button.dataset.refund||button.dataset.contest,Boolean(button.dataset.contest));renderAll();persist();showReturns();notify(claim.status==='dismissed'?'False claim dismissed by the expert seal.':'Refund settled.');return; }
    if (button.dataset.gather) { startHarvest(button.dataset.gather); return; }

    if (button.dataset.test) { testPotion(button.dataset.test); return; }
    if (button.dataset.resetSubject) { resetExperimentSubject(state, button.dataset.resetSubject); experimentReport = null; renderAll(); persist(); showExperiments(); return; }
    if (button.dataset.restock) { const result = restock(state, Number(button.dataset.restock), 20); renderAll(); persist(); showInventory(); notify(`Refilled ${result.quantity} ml for ${result.cost} coins.`); return; }
    if (button.dataset.trade) { const result = tradeStock(state, Number(button.dataset.trade)); renderAll(); persist(); showInventory(); notify(`Traded ${result.quantity} ml for ${result.payment} coins.`); return; }
    if (button.dataset.upgrade) { const upgrade = buyUpgrade(state, Number(button.dataset.upgrade)); brew.equipment = state.equipment; audio.play('sale'); renderAll(); persist(); showGuild(); notify(`${upgrade.name} is ready.`); return; }
    if (button.dataset.observation) {
      const report = state.experiments.records.find(record => record.serial === Number(button.dataset.observation));
      if (!report) throw new Error('Experiment not found.');
      showDiscovery(report.preparation?.mass ? report.preparation : report.sample); return;
    }
    if (button.dataset.prepare) { prepareRecipe(Number(button.dataset.prepare)); return; }
    switch (button.dataset.action) {
      case 'close': closeSheet(); break;
      case 'confirm-new': openWorld($('worldSeed').value.trim() || randomSeed()); break;
      case 'confirm-clean': brew.clean(); closeSheet(); renderAll(); persist(); notify('Cauldron drained and cleaned.'); break;
      case 'sell': sell(); break;
      case 'potion-id': showPotionID();break;
      case 'compile-id': { const estimates=Object.fromEntries([...$('sheetContent').querySelectorAll('[data-estimate]')].map(input=>[input.dataset.estimate,Number(input.value)/100])); compilePotionId(state,latestInspection,estimates,$('potionName').value);persist();if(state.pendingBottle)showVial();else {closeSheet();notify('Potion ID compiled. Bottle when ready.');}break; }
      case 'counter-offer': counterOffer(state,Number($('sellerPrice').value));showNegotiation();break;
      case 'accept-offer': finishAgreement();break;
      case 'certify': certifyPotion(state);renderAll();persist();showVial();break;
      case 'returns': showReturns();break;
      case 'harvest': finishHarvest();break;
      case 'untreated': showUntreated=!showUntreated;button.textContent=showUntreated?'Observe response':'Untreated view';button.setAttribute('aria-pressed',String(showUntreated));break;
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
    if(event.target.dataset.estimate) { $('sheetContent').querySelector(`[data-estimate-value="${event.target.dataset.estimate}"]`).textContent=event.target.value+'%'; }
    if (event.target.id === 'thermalPower') {
      const power = Number(event.target.value) / 100, kind = event.target.dataset.thermal;
      brew.setThermal(kind === 'heat' ? power : 0, kind === 'cool' ? power : 0);
      $('thermalReadout').textContent = `${Math.round(power * 100)}% power`; renderTools(); persist();
    }
  });
  $('sheetContent').onchange = async event => {
    try {
      if (event.target.id === 'trialDose') testDose=Number(event.target.value);
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
  if(currentRoom==='harvest'&&harvest){const phase=((now-harvest.start)/1500)%2;harvest.position=phase<1?phase:2-phase;$('harvestMarker').style.left=`${harvest.position*100}%`;}
  if(currentRoom==='experiments'&&testingRenderer){const subject=state.experiments.subjects[selectedSubject],report=state.experiments.records.find(r=>r.subjectId===selectedSubject);testingRenderer.render(subject,report,now,showUntreated);}
  if(state&&inShop&&!isSandbox()&&now-lastClaims>1000){lastClaims=now;const before=JSON.stringify((state.complaints||[]).map(c=>c.status));const arrived=advanceComplaints(state);if(arrived.length||before!==JSON.stringify((state.complaints||[]).map(c=>c.status))){renderAll();persist();if(!$('sheet').open&&arrived.length)showReturns();else notify('A customer return has reached the counter.');}}
  if (inShop && renderer && !$('sheet').open && now - lastRender >= (renderer.quality === 'eco' ? 32 : 16)) { renderer.render(); lastRender = now; }
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url), { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {});
  requestAnimationFrame(loop);
}
try { boot(); }
catch (err) {
  console.error(err); document.body.dataset.gameState = 'error';
  const message = document.createElement('p'); message.className = 'startup'; message.textContent = `Startup failed: ${err.message}. Please reload the shop.`; document.body.append(message);
}
