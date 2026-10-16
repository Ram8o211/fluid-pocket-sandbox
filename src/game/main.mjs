import { TestingRenderer } from './TestingRenderer.mjs';
import { RabbitColonyRenderer, drawRabbit } from './RabbitRenderer.mjs';
import { loadRabbitArtwork, rabbitArtworkVersion } from './RabbitAssets.mjs';
import { rabbitById, advanceRabbits, buyRabbit, moveRabbit, cullRabbit, rabbitRemains, recoverRabbitIngredients } from './rabbits.mjs';
import { findPotionId, compilePotionId } from './potionId.mjs';
import { startNegotiation, counterOffer, acceptCustomerOffer, certificationCost, certifyPotion, certificateFor, advanceComplaints, resolveComplaint } from './commerce.mjs';
import { generateWorld, availableIngredients, seedNumber } from './world.mjs';
import { BrewingSession } from './brewing.mjs';
import { newShop, restock, tradeStock, discardVial, UPGRADES, upgradeStatus, buyUpgrade, completeSale, nextCustomer, recordDiscovery, guildLoan } from './economy.mjs';
import { assessPotion, priceSale, requirementDescription } from './evaluation.mjs';
import { saveShop, loadShop, encodeSave, decodeSave, SANDBOX_SAVE_KEY } from './persistence.mjs';
import { propertyDescription } from './potion.mjs';
import { FIXED_STEP, PROPERTIES } from './contracts.mjs';
import { LaboratoryRenderer } from './LaboratoryRenderer.mjs';
import { insideCauldron } from './cauldron.mjs';
import { icon, bottleSprite, ingredientSprite, naturalLandscapeSprite, experimentSubjectSprite, portraitSprite, workshopBackground } from './art.mjs';
import { hudIcon, hudAsset } from './hud.mjs';
import { resourceStatus, gatherIngredient, tendGarden, gardenStamina } from './gathering.mjs';
import { runExperiment, splitPotionSample, currentExperimentReport } from './experiments.mjs';
import { returnVialToCauldron, potionRecord } from './potionTransfer.mjs';
import { EFFECT_DEFINITIONS, EFFECT_PROPERTIES, describeEffects } from './effects.mjs';
import { observedPotion, discoveryKnowledge } from './knowledge.mjs';
import { ShopAudio } from './audio.mjs';
import { AdaptiveQuality } from '../performance/AdaptiveQuality.mjs';
import { sandboxIngredientProperties, sandboxMixtureProperties } from './sandboxProperties.mjs';
import { arcaneTriggerTemperature, ARCANE_MARGIN } from '../simulation/ArcaneSolver.mjs';

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
let colonyRenderer = null, cullMode = false, lastRabbitTick = 0;
let sandboxInspectorOpen = false, sandboxInspectorTab = 'ingredient', lastSandboxInspection = 0;
const isSandbox = () => state?.mode === 'sandbox';
const rawIngredient = i => Boolean(i.form && !['liquid', 'powder'].includes(i.form));
const ingredientUnit = i => i.form && i.form !== 'liquid' ? 'measures' : 'ml';

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
  // Structural colony updates keep the current reading position and focus.
  // Dosing updates the existing controls in place (see refreshRabbitTrial).
  const keepTrial = title === 'Rabbit trials' && currentRoom === 'experiments' && $('sheet').open;
  const previous = keepTrial ? {
    scroll: $('sheetContent').querySelector('.sheet-body').scrollTop,
    rack: $('rabbitSelector')?.scrollLeft || 0,
    colony: $('colonyOverview')?.open,
    notebook: $('rabbitNotebook')?.open,
    focus: document.activeElement?.id ? `#${document.activeElement.id}`
      : ['subject','action','test'].map(key => document.activeElement?.dataset?.[key] ? `[data-${key}="${document.activeElement.dataset[key]}"]` : '').find(Boolean)
  } : null;
  clearInterval(roomTimer); roomTimer = 0; currentRoom = null; testingRenderer = null; colonyRenderer = null; harvest = null;
  $('sheet').classList.toggle('rabbit-room', title === 'Rabbit trials');
  assist = false; pointer = null; stopPour();
  $('sheetContent').innerHTML = `<header class="sheet-header"><h2 id="sheetTitle">${escape(title)}</h2><button class="icon-button" data-action="close" aria-label="Close panel">${icon('close')}</button></header><div class="sheet-body"><output id="panelNotice" class="panel-notice" role="status" hidden></output>${content}</div>${footer ? `<div class="sheet-footer">${footer}</div>` : ''}`;
  if (title === 'Rabbit trials') {
    $('sheetTitle').insertAdjacentHTML('afterbegin', '<img class="trial-title-rabbit" src="./public/assets/rabbit-trials/01_rabbits/portrait_moon.png" alt="" aria-hidden="true">');
  }
  if (!$('sheet').open) $('sheet').showModal();
  if (previous) {
    if ($('colonyOverview')) $('colonyOverview').open = previous.colony;
    if ($('rabbitNotebook')) $('rabbitNotebook').open = previous.notebook;
    if (previous.focus) $('sheetContent').querySelector(previous.focus)?.focus({ preventScroll: true });
    $('sheetContent').querySelector('.sheet-body').scrollTop = previous.scroll;
    if ($('rabbitSelector')) $('rabbitSelector').scrollLeft = previous.rack;
  }
}
function closeSheet() { clearInterval(roomTimer); roomTimer = 0; currentRoom = null; testingRenderer = null; colonyRenderer = null; harvest = null; if ($('sheet').open) $('sheet').close(); }

async function openWorld(seed, saved = null, mode = 'shop') {
  $('newWorldBtn').disabled = true; $('continueBtn').disabled = true;
  await new Promise(resolve => setTimeout(resolve, 0));
  let session;
  try {
    const world = saved?.world || generateWorld(seed);
    const candidate = saved || newShop(world, { sandbox: mode === 'sandbox' });
    session = new BrewingSession(world.ingredients, candidate.equipment);
    if (saved?.brew) session.restore(saved.brew);
    renderer?.dispose(); brew?.dispose();
    state = candidate; advanceComplaints(state); advanceRabbits(state); brew = session; selected = availableIngredients(world, state.equipment)[0].id; experimentReport = null;
    selectedSubject = state.experiments.rabbits.find(r => r.stats.alive)?.id || state.experiments.rabbits[0].id; cullMode = false;
    renderer = new LaboratoryRenderer($('labCanvas'), brew); renderer.setQuality(state.settings.graphics);
    audio.enabled = state.settings.sound;
    $('shop').insertBefore($('toast'), $('shop').querySelector('.shop-navigation'));
    inShop = true; accumulator = 0; $('menu').hidden = true; $('shop').hidden = false;
    $('ingredientRack').scrollLeft = 0;
    closeSheet(); renderAll(); persist();
    if (state.stage === 'sale' && state.lastSale) showSale();
    else if (state.pendingBottle) showVial();
    else notify(isSandbox() ? 'Infinite ingredients, every instrument, and room to experiment.' : saved ? 'Welcome back to your shop.' : 'Your first customer is here. Gather, grind, and brew.');
  } catch (err) { if (session && session !== brew) session.dispose(); notify(err.message); $('saveMessage').textContent = 'This save has been preserved. You can open a new shop with another seed.'; }
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
  $('coins').innerHTML = `${hudIcon('coin')}<span>${isSandbox() ? '∞' : Math.floor(state.coins)}</span>`;
  $('reputation').innerHTML = `${hudIcon('star')}<span>${isSandbox() ? 'Sandbox' : `Reputation ${state.reputation}`}</span>`;
  $('orderPanel').hidden = isSandbox(); $('sandboxNotice').hidden = !isSandbox();
  $('settingsBtn').innerHTML = hudIcon('settings'); $('skipTutorial').innerHTML = icon('close');
  $('worldLabel').textContent = `World: ${state.seed}`;
  const order = state.order;
  $('customerPortrait').src = order.customer.name === 'Elara' ? hudAsset('portrait') : portraitSprite(order.customer.portraitSeed);
  $('customerName').textContent = order.customer.name; $('customerRole').textContent = order.customer.role;
  $('orderNumber').textContent = `COMMISSION ${state.completed + 1} · ${order.volume} ML`;
  $('orderBudget').innerHTML = `${order.budget} ${hudIcon('coin')}`;
  $('customerDialogue').textContent = order.customer.dialogue;
  const requirementRow = r => `<div class="requirement${r.comparison === 'maximum' ? ' unwanted-effect' : ''}">${r.property === 'color' ? `<span class="colour-swatch" style="background:${escape(r.target)}"></span>` : icon(r.property === 'temperature' || r.property === 'fire' ? 'flame' : r.property === 'freeze' || r.property === 'stability' ? 'frost' : EFFECT_PROPERTIES.includes(r.property) || r.property === 'potency' ? 'star' : 'measure')}<div><span class="req-label">${PROPERTIES[r.property].label.toUpperCase()}${r.comparison === 'maximum' ? ' · LIMIT' : r.hard ? ' · REQUIRED' : ''}</span><span class="req-target">${escape(requirementDescription(r))}</span></div></div>`;
  const wanted = order.requirements.filter(r => r.comparison !== 'maximum'), limits = order.requirements.filter(r => r.comparison === 'maximum');
  $('requirements').innerHTML = wanted.map(requirementRow).join('') + (limits.length ? `<details class="order-limits"><summary>Unwanted effects · ${limits.length} limits</summary><div class="requirements">${limits.map(requirementRow).join('')}</div></details>` : '');
  $('orderClue').textContent = order.clue;
  for (const [id, sprite, label] of [['measureBtn', 'flask', 'Potion ID'], ['inventoryBtn', 'inventory', 'Ingredients'], ['bookBtn', 'book', 'Recipe book']]) $(id).innerHTML = hudIcon(sprite) + `<span>${label}</span>`;
  $('upgradesBtn').innerHTML = icon('guild') + '<span>Guild</span>';
  $('natureBtn').innerHTML = `${hudIcon('leaf')}<span>Garden</span>`;
  $('experimentsBtn').innerHTML = `${hudIcon('trials')}<span>Trials</span>`;
  $('complaintsBtn').innerHTML = `${hudIcon('coin')}<span>Returns ${(state.complaints || []).filter(c=>c.status==='pending').length || ''}</span>`;
  renderRack(); renderTools(); updateHUD(); updateTutorial();
  document.body.dataset.gameState = state.stage;
}
function sandboxTemperature(value) {
  return Number.isFinite(value) ? (value * 100).toFixed(1) + '°A' : '—';
}
function sandboxActivationLabel(threshold) {
  const trigger = arcaneTriggerTemperature(threshold) + (threshold < 0 ? -ARCANE_MARGIN : ARCANE_MARGIN);
  return (threshold < 0 ? 'Cool below ' : 'Heat above ') + sandboxTemperature(trigger);
}
function sandboxAwakening(properties) {
  const fraction = Math.round(Math.max(0, Math.min(1, properties.awakenedFraction || 0)) * 100);
  const charge = Math.round(Math.max(0, Math.min(1, properties.awakeningCharge || 0)) * 100);
  const effect = properties.dominantEffect ? EFFECT_DEFINITIONS[properties.dominantEffect]?.label : null;
  const expected = EFFECT_PROPERTIES.filter(key => (properties.awakeningEffects?.[key] || 0) >= .005)
    .map(key => escape(EFFECT_DEFINITIONS[key].label) + ' ' + Math.round(properties.awakeningEffects[key] * 100) + '%').join(' · ');
  const activation = sandboxActivationLabel(properties.arcaneThreshold);
  const status = fraction === 100 ? 'Awakened' : fraction > 0 ? fraction + '% awakened'
    : charge > 0 ? 'Charging ' + charge + '%' : 'Dormant';
  const explanation = !effect
    ? 'No active enchantment to amplify. Add magical ingredients to create an activation threshold.'
    : !properties.awakeningReachable && fraction === 0
      ? 'This potion cannot awaken at usable temperatures. Mix ingredients with different activation temperatures to shift the trigger.'
      : 'Maintain the required temperature for about 0.4 s: awakened effects follow the proportions of the ingredients; other effects become zero.';
  return '<section class="sandbox-awakening" aria-label="Arcane supertransformation">' +
    '<div class="sandbox-awakening-title"><strong>✦ Arcane supertransformation</strong><span>' + status + '</span></div>' +
    '<div class="sandbox-awakening-grid"><div><small>Activation temperature</small><strong>' + activation + '</strong></div>' +
    '<div><small>Awakened effects</small><strong>' + (expected || 'None') + '</strong></div></div>' +
    '<p>' + explanation + '</p></section>';
}
function sandboxReadings(properties) {
  return '<div class="sandbox-effect-grid">' + EFFECT_PROPERTIES.map(key =>
    '<div class="sandbox-effect"><span style="color:' + EFFECT_DEFINITIONS[key].color + '">' +
    escape(EFFECT_DEFINITIONS[key].label) + '</span><strong>' +
    Math.round(Math.max(0, Math.min(1, properties.effects[key] || 0)) * 100) + '%</strong></div>'
  ).join('') + '</div><div class="sandbox-transition-row">' +
    '<span>Melt <strong>' + sandboxTemperature(properties.meltingTemperature) + '</strong></span>' +
    '<span>Boil <strong>' + sandboxTemperature(properties.boilingTemperature) + '</strong></span>' +
    '<span>Ignite <strong>' + sandboxTemperature(properties.combustionTemperature) + '</strong></span>' +
    '</div>' + sandboxAwakening(properties);
}
function renderSandboxInspector() {
  if (!sandboxInspectorOpen || !isSandbox()) return;
  const body = $('sandboxInspectorBody');
  let markup;
  if (sandboxInspectorTab === 'ingredient') {
    const ingredients = availableIngredients(state.world, state.equipment);
    const ingredient = ingredients.find(item => item.id === selected) || ingredients[0];
    const properties = sandboxIngredientProperties(ingredient);
    markup = '<label class="sandbox-source-picker">Ingredient <select id="sandboxInspectIngredient" aria-label="Choose ingredient to inspect">' +
      ingredients.map(item => '<option value="' + item.id + '"' + (item.id === selected ? ' selected' : '') + '>' + escape(item.name) + '</option>').join('') +
      '</select></label>' + (properties ? sandboxReadings(properties) : '<p>No ingredient selected.</p>');
  } else {
    const groups = sandboxMixtureProperties(brew);
    markup = groups.length ? groups.map(group => {
      const sources = group.sources.map(source => escape(source.name) + ' ' + Math.round(source.fraction * 100) + '%').join(' · ');
      return '<article class="sandbox-mixture-card"><div class="sandbox-mixture-heading"><strong>' + group.label +
        '</strong><span>' + (group.homogeneous ? 'Homogeneous' : 'Not yet homogeneous') + '</span></div>' +
        '<div class="sandbox-mixture-sources">' + sources + ' · Current ' + sandboxTemperature(group.temperature) + '</div>' +
        (group.homogeneous ? sandboxReadings(group) : '<p class="sandbox-mix-warning">Properties still vary between parcels. Stir to blend before reading one set of values.</p>') +
        '</article>';
    }).join('') : '<p class="sandbox-empty-mix">The cauldron is empty. Add ingredients to inspect its mixtures.</p>';
  }
  const oldScroll = body.scrollTop;
  if (body.innerHTML !== markup) {
    body.innerHTML = markup;
    body.scrollTop = oldScroll;
  }
  lastSandboxInspection = performance.now();
}
function syncSandboxInspector() {
  if (!isSandbox()) sandboxInspectorOpen = false;
  const open = isSandbox() && sandboxInspectorOpen;
  $('sandboxInspector').hidden = !open;
  $('ingredientRack').hidden = open;
  $('sandboxPropertiesBtn').setAttribute('aria-expanded', String(open));
  $('sandboxPropertiesBtn').textContent = open ? '✕ Close properties' : '✦ Show properties';
  $('sandboxIngredientTab').setAttribute('aria-pressed', String(sandboxInspectorTab === 'ingredient'));
  $('sandboxMixtureTab').setAttribute('aria-pressed', String(sandboxInspectorTab === 'mixture'));
  if (open) renderSandboxInspector();
}

function renderRack() {
  const rack = $('ingredientRack'), scroll = rack.scrollLeft, ingredients = availableIngredients(state.world, state.equipment);
  rack.innerHTML = ingredients.map(i => `<button class="ingredient-card${i.id === selected ? ' selected' : ''}" data-ingredient="${i.id}" aria-label="Select ${escape(i.name)}, ${i.form || 'liquid'}" aria-pressed="${i.id === selected}"><img src="${i.solvent ? hudAsset('water') : ingredientSprite(i)}" alt="" draggable="false"><span>${escape(i.name)}</span><small>${isSandbox() ? '∞' : Math.floor(state.inventory[i.id] || 0)}</small><small class="ingredient-effects">${describeEffects(i.material).slice(0, 2).map(e => `${escape(e.label)} ${Math.round(e.value * 100)}%`).join(' · ') || 'Neutral solvent'}</small></button>`).join('');
  rack.scrollLeft = scroll;
  const ingredient = ingredients.find(i => i.id === selected) || ingredients[0]; selected = ingredient.id;
  $('selectedName').textContent = ingredient.name + (ingredient.form && ingredient.form !== 'liquid' ? ` · ${ingredient.form}` : '');
  $('doseUnit').textContent = ingredientUnit(ingredient) === 'ml' ? 'ml' : 'qty';
  const action = ingredient.form && ingredient.form !== 'liquid' ? 'Add' : 'Pour';
  $('pourBtn').innerHTML = `${hudIcon('vial')}${action} ${dose}${ingredientUnit(ingredient) === 'ml' ? ' ml' : ' whole'}`;
  if (ingredient.form === 'powder') $('pourBtn').innerHTML = `${hudIcon('vial')}Add ${dose} powder`;
  $('pourBtn').setAttribute('aria-label', `${action} ${dose} ${ingredientUnit(ingredient)} of ${ingredient.name}`);
  $('pourBtn').disabled = Boolean(state.pendingBottle) || state.stage === 'sale';
  $('grindBtn').hidden = !rawIngredient(ingredient);
  $('grindBtn').textContent = `Grind & add ${dose} measures`;
  $('grindBtn').disabled = $('pourBtn').disabled;
  syncSandboxInspector();
}
function renderTools() {
  $('heatBtn').innerHTML = `${hudIcon('flame')}<span>Flame <small>${brew.heat ? `${Math.round(brew.heat * 100)}%` : 'OFF'}</small></span>`;
  $('heatBtn').classList.toggle('active', brew.heat > 0); $('heatBtn').setAttribute('aria-label', `Adjust flame, ${Math.round(brew.heat * 100)} percent`);
  $('coolBtn').innerHTML = `${hudIcon('frost')}<span>Frost <small>${brew.cool ? `${Math.round(brew.cool * 100)}%` : 'OFF'}</small></span>`;
  $('coolBtn').classList.toggle('cold', brew.cool > 0); $('coolBtn').setAttribute('aria-label', `Adjust cooling, ${Math.round(brew.cool * 100)} percent`);
  $('stirBtn').innerHTML = `${hudIcon('spoon')}<span>Stir <small>HOLD</small></span>`;
  $('crushBtn').innerHTML = `${hudIcon('pestle')}<span>Pestle <small>CRUSH</small></span>`;
  $('crushBtn').classList.toggle('active', tool === 'pestle'); $('crushBtn').setAttribute('aria-pressed', String(tool === 'pestle'));
  $('cleanBtn').innerHTML = `${hudIcon('clean')}<span>Clean <small>CAULDRON</small></span>`;
  for (const id of ['heatBtn', 'coolBtn', 'stirBtn', 'crushBtn', 'cleanBtn']) $(id).disabled = Boolean(state.pendingBottle) || state.stage === 'sale';
}
function updateHUD() {
  if (!brew || !state) return;
  const volume = brew.liquidVolume;
  const steam = brew.vaporVolume, condensing = steam > .01;
  $('volume').textContent = isSandbox() ? `${Math.round(volume)} ml liquid · ${Math.round(brew.occupiedVolume)} / ${brew.capacity}` : `${Math.round(volume)} / ${state.order.volume} ml`;
  $('labStatus').textContent = state.pendingBottle ? 'VIAL READY' : state.stage === 'sale' ? 'COMMISSION COMPLETE' : condensing ? `SEALED · ${steam.toFixed(1)} ML STEAM` : `SEALED CAULDRON · ${brew.capacity} ML`;
  $('labHint').textContent = state.pendingBottle ? isSandbox() ? 'Test your vial in the experiments room' : 'Test the potion or serve your customer' : condensing ? brew.heat ? 'Steam is trapped · turn off Flame to condense' : 'Steam is condensing · Frost helps it return faster' : brew.engine.ps.count ? brew.heat ? 'Warmth helps ground ingredients blend with water' : brew.cool ? 'Frost cools the brew and condenses trapped steam' : 'Grind plants and stones · stir with plenty of water' : 'Start with water · grind a little plant or stone';
  const bottleMarkup = `${state.stage === 'sale' ? icon('arrow') : hudIcon('vial')}${state.stage === 'sale' ? 'Next customer' : state.pendingBottle ? isSandbox() ? 'Inspect vial' : 'Review & sell' : condensing ? 'Wait for condensation' : `Bottle ${isSandbox() ? dose : state.order.volume} ml`}`;
  if ($('bottleBtn').innerHTML !== bottleMarkup) $('bottleBtn').innerHTML = bottleMarkup;
  $('bottleBtn').disabled = state.stage !== 'sale' && !state.pendingBottle && (volume < 1 || condensing);
  $('bottleBtn').title = condensing ? 'Cool the trapped steam back into liquid before bottling.' : '';
  $('crushBtn').setAttribute('aria-pressed', String(tool === 'pestle')); $('crushBtn').classList.toggle('active', tool === 'pestle');
  if (tool === 'pestle' && !state.pendingBottle && !condensing) $('labHint').textContent = 'Tap or drag the pestle on raw or frozen matter';
  else if (!state.pendingBottle && state.stage === 'brewing' && !condensing && !brew.heat && !brew.cool)
    $('labHint').textContent = 'Tap or hold inside to pour · drag to stir';
  $('stirBtn').setAttribute('aria-pressed', String(assist)); $('stirBtn').classList.toggle('active', assist);
  if (sandboxInspectorOpen && sandboxInspectorTab === 'mixture' && performance.now() - lastSandboxInspection > 750) renderSandboxInspector();
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
function pour(crushed = false, point = null) {
  if (!inShop || !state || state.pendingBottle || state.stage !== 'brewing' || $('sheet').open) { stopPour(); return 0; }
  const ml = brew.pour(selected, dose, state.inventory, { crushed: crushed === true, infinite: isSandbox(), point });
  if (!ml) { stopPour(); notify(brew.occupiedVolume >= brew.capacity - 1 ? 'The cauldron is full. Bottle or clean it.' : 'This ingredient is depleted. Gather more in the Wild garden.'); return; }
  audio.play('pour'); renderRack(); updateHUD(); advanceTutorial(); persist();
  return ml;
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
  sheet('Write a potion ID',`<p>Your observations, your estimates. Compare doses and untreated creatures; the guild does not fill in the answers.</p><input id="potionName" class="name-input" aria-label="Potion name" maxlength="40" placeholder="Potion name" value="${escape(document?.name || '')}"><details class="rabbit-notebook"><summary>Evidence from this batch</summary>${rabbitTrialNotes(state.experiments.records.filter(r=>r.sample.batchId===sample.batchId).slice(0,12))}</details><label class="potion-notes-label">My observations<textarea id="potionNotes" class="name-input potion-notes" maxlength="1500" placeholder="Visible changes, dose progression, survival, and uncertainty">${escape(document?.notes || '')}</textarea></label><div class="estimate-carousel mini-pages">${EFFECT_PROPERTIES.map(key=>`<article class="mini-card estimate-card"><h3 style="color:${EFFECT_DEFINITIONS[key].color}">${EFFECT_DEFINITIONS[key].label}</h3><div class="estimate-glyph" style="color:${EFFECT_DEFINITIONS[key].color}">✧</div><label>My estimate <output data-estimate-value="${key}">${Math.round((document?.estimates[key]||0)*100)}%</output><input type="range" data-estimate="${key}" aria-label="Estimate ${EFFECT_DEFINITIONS[key].label}" min="0" max="100" step="1" value="${Math.round((document?.estimates[key]||0)*100)}"></label></article>`).join('')}</div><p class="swipe-cue">Swipe through all eight enchantments →</p><button class="primary" data-action="compile-id">Compile potion ID</button><button class="secondary" data-action="experiments">Observe another trial</button>`);
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
  sheet('Sealed potion',`<div class="vial-preview"><img src="${bottleSprite(vial.color)}" alt="Bottled potion"><div><h3>${escape(document?.name || 'Unidentified potion')}</h3><p>${vial.volume.toFixed(1)} / ${state.order.volume} ml</p>${document?`<small>${escape(document.id)}</small>`:''}</div></div>${effectRows(vial,document)}${document?'<p class="quiet">Your written estimates. The customer will discover the real effects after using it.</p>':''}<div class="vial-actions"><button class="primary" data-action="${isSandbox()?'experiments':'sell'}"${!isSandbox()&&!document?' disabled':''}>${isSandbox()?'Creature trials':'Negotiate price'}</button><button class="secondary" data-action="return-vial">Pour back · ${vial.volume.toFixed(1)} ml</button><button class="secondary" data-action="experiments">Test a spare dose</button><button class="secondary" data-action="potion-id">${document?'Edit potion ID':'Write potion ID'}</button>${!isSandbox()?`<button data-action="certify"${seal||state.coins<cost||!document?' disabled':''}>${seal?'Expert seal attached':`Expert seal · ${cost} coins`}</button><p class="quiet">A seal applies only to this batch. It defeats false claims; genuine faults still require a refund.</p>`:''}<button data-action="save-inspection">Remember formula</button><button class="danger-button" data-action="discard-vial">Discard vial</button></div>`);
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
  sheet(`${state.order.customer.name}'s request`,`<p class="sale-dialogue">“${escape(state.order.customer.dialogue)}”</p><p>${state.order.volume} ml · budget ${state.order.budget} coins</p><div class="mini-pages">${state.order.requirements.map(r=>`<article class="mini-card"><h3>${PROPERTIES[r.property].label}</h3><div class="estimate-glyph">✧</div><p>${escape(requirementDescription(r))}</p><p class="quiet">${r.comparison==='maximum'?'Unwanted enchantment':'Desired enchantment'}</p></article>`).join('')}</div><p class="swipe-cue">Swipe through the request →</p>`);
}

async function moveToNext() {
  const button = $('sheetContent').querySelector('[data-action="next"]'); if (button) button.disabled = true;
  await new Promise(resolve => setTimeout(resolve, 0));
  try { nextCustomer(state); $('orderClue').hidden = true; closeSheet(); renderAll(); persist(); notify(`${state.order.customer.name} has arrived.`); }
  catch (err) { if (button) button.disabled = false; notify(err.message); }
}
function showInventory() {
  const rows = availableIngredients(state.world,state.equipment).map(i=>`<article class="mini-card stock-card"><img src="${ingredientSprite(i)}" alt=""><h3>${escape(i.name)}</h3><p>${isSandbox()?'∞':Math.floor(state.inventory[i.id]||0)} ${ingredientUnit(i)}</p><p>${escape(i.lore)}</p>${effectRows(i.material,true)}<p class="quiet">Activation temperature: ${sandboxActivationLabel(i.material.arcaneThreshold)}. Mixing ingredients changes this temperature.</p>${i.recoverOnly?'<button class="primary" data-action="experiments">Visit rabbit trials</button>':`<button class="primary" data-garden-node="${state.foraging.nodes.find(n=>n.ingredientId===i.id)?.id}">Visit garden bed</button>`}${!isSandbox()&&!i.recoverOnly?`<button data-restock="${i.id}">Village parcel · 20 · ${i.solvent?0:Math.ceil(i.price*100+8)} coins</button>`:''}</article>`).join('');
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
function rabbitCondition(rabbit) {
  if (rabbit.remainsRecovered) return 'Remains recovered';
  if (!rabbit.stats.alive) return rabbit.deathAppearance === 'dissolved' ? 'Dissolved' : rabbit.deathAppearance === 'charred' ? 'Carbonized' : `Dead · ${rabbit.causeOfDeath || 'exposure'}`;
  if (rabbit.dangerous) return 'Dangerous · isolate or cull';
  if (rabbit.stats.health < 35) return 'Critical condition';
  if (rabbit.stats.health < 75) return 'Injured';
  return rabbit.trials ? 'Modified' : 'Untreated';
}
function selectedRabbit() { return rabbitById(state.experiments,selectedSubject) || state.experiments.rabbits[0]; }
function visibleTrial(rabbit) {
  const report = currentExperimentReport(state,rabbit.id);
  if (!report || rabbit.deathAt && rabbit.deathAt > report.at) return null;
  const recorded = report.afterRabbit;
  if (recorded && (recorded.age !== rabbit.age || recorded.stats.alive !== rabbit.stats.alive ||
    Math.abs(recorded.stats.health - rabbit.stats.health) > .000001 ||
    Math.abs(recorded.stats.growth - rabbit.stats.growth) > .000001)) return null;
  return report;
}
function rabbitTrialNotes(reports) {
  return reports.map(r=>`<article class="rabbit-trial-note"><strong>${escape(r.subjectName)} · ${r.volume.toFixed(1)} ml · ${r.beforeRabbit?.age || 'adult'} · ${r.beforeRabbit?.location || 'pen'}</strong><p>${r.beforeRabbit?.trials ? `Previously exposed: ${r.beforeRabbit.trials} earlier doses.` : r.beforeRabbit?.age==='baby'?'Fresh baby · fragile baseline.':'Fresh adult baseline.'}</p><ul>${r.observations.map(o=>`<li>${escape(o)}</li>`).join('')}</ul></article>`).join('');
}
function showExperiments() {
  loadRabbitArtwork();
  advanceRabbits(state);
  const subject=selectedRabbit(); selectedSubject=subject.id;
  const available=state.pendingBottle?.volume || brew.liquidVolume;
  const living=state.experiments.rabbits.filter(r=>r.stats.alive).length,price=isSandbox()?0:state.equipment.densimeter?6:8;
  sheet('Rabbit trials',`<div class="rabbit-room-layout"><section class="rabbit-workbench" aria-label="Selected rabbit and potion trial">
    <div id="rabbitSelector" class="subject-selector rabbit-selector" aria-label="Choose a rabbit">${state.experiments.rabbits.map(c=>`<button type="button" data-subject="${c.id}" class="${c.id===selectedSubject?'active':''} ${!c.stats.alive?'rabbit-dead':''}" aria-pressed="${c.id===selectedSubject}" aria-label="${cullMode?'Cull':'Select'} ${escape(c.name)}, ${c.age}, ${c.location}, ${escape(rabbitCondition(c))}"><span class="rabbit-card-glyph"><canvas data-rabbit-portrait="${c.id}" width="80" height="60" aria-hidden="true"></canvas></span><strong>${escape(c.name)}</strong><span>${c.age} · ${c.sex==='female'?'♀':'♂'} · ${c.location}</span><small>${escape(rabbitCondition(c))}</small></button>`).join('')}</div>
    <section class="rabbit-detail-panel" aria-label="Rabbit condition and trial playback">
    <div class="rabbit-detail-heading"><h3 id="rabbitName">${escape(subject.name)}</h3><span id="rabbitCondition"></span></div>
    <p id="rabbitContext" class="quiet"></p>
    <div class="trial-comparison"><div class="trial-stage-labels"><span>Before dose</span><span id="trialViewLabel">Current condition</span></div>
    <canvas id="creatureCanvas" width="640" height="350" aria-label="Pixel art rabbit, comparing the condition before and after this dose"></canvas>
    </div>
    <div class="trial-playback"><button type="button" data-action="untreated" aria-pressed="false">Before dose</button><button type="button" data-action="replay-trial">Replay dose</button><button type="button" data-action="pause-trial" aria-pressed="false">Pause view</button></div>
    <output id="trialFeedback" class="trial-feedback" role="status" aria-live="polite"></output>
    <div class="rabbit-actions"><button type="button" data-action="move-rabbit">Isolate in cage</button><button type="button" class="danger-button" data-action="cull-rabbit">Cull ${escape(subject.name)}</button></div>
    <section id="rabbitRecovery" class="rabbit-recovery" aria-label="Recover potion ingredients from remains" hidden><p id="remainsLoot"></p><button type="button" class="secondary" data-action="recover-rabbit">Recover ingredients</button></section>
    </section>
    <details id="rabbitNotebook" class="rabbit-notebook"><summary>Trial observations</summary><div id="rabbitTrialNotes"></div></details>
    <div class="trial-actions"><button type="button" class="primary" data-action="potion-id">Write potion ID</button><button type="button" class="secondary" id="trialReturn" data-action="close">Back to brewing</button></div>
    <button type="button" class="trial-vial-link" data-action="review-vial"${!state.pendingBottle?' hidden':''}>Back to vial</button>
    </section><section class="rabbit-colony" aria-label="Rabbit colony management">
    <details id="colonyOverview" class="colony-overview"${matchMedia('(min-width:760px)').matches?' open':''}><summary>Pen &amp; isolation cage · <span id="colonyCount">${living} / ${state.experiments.capacity} rabbits</span></summary>
    <p class="colony-help">Tap a rabbit to select it. Move it to the cage for a separate trial.</p>
    <canvas id="rabbitPenCanvas" width="640" height="350" aria-label="Shared rabbit pen and isolation cage. The rabbit buttons also select or cull a rabbit."></canvas></details>
    <div id="colonyAlerts" class="colony-alerts" role="status"></div>
    <div class="colony-toolbar"><button type="button" data-action="buy-rabbit"${living>=state.experiments.capacity||!isSandbox()&&state.coins<price?' disabled':''}>Buy adult · ${price} coins</button><button type="button" data-action="cull-tool" class="${cullMode?'cull-active':''}" aria-pressed="${cullMode}">Cull tool ${cullMode?'ON':'OFF'}</button></div>
    <p class="colony-help">Rabbits hop, sniff and graze inside the fence. Select a fallen rabbit to recover a small harvest for your potions.</p>
    <details><summary>Colony journal</summary><ol id="colonyJournal" class="colony-journal"></ol></details>
    </section></div>`,
    `<div id="experimentReport" class="trial-controls"><label for="trialDose">Dose <select id="trialDose">${[2,5,10,20].map(v=>`<option value="${v}"${testDose===v?' selected':''}>${v} ml</option>`).join('')}</select></label><button type="button" class="primary" data-test="${subject.id}">Give dose · ${escape(subject.name)}</button></div><div class="trial-dose-status"><span id="trialQuantity">${available.toFixed(1)} ml available</span><span id="trialRest" role="status"></span></div>`);
  currentRoom='experiments';testingRenderer=new TestingRenderer($('creatureCanvas'));colonyRenderer=new RabbitColonyRenderer($('rabbitPenCanvas'));
  $('rabbitPenCanvas').onclick=guard(event=>{const id=colonyRenderer?.hitTest(event.clientX,event.clientY);if(!id)return;if(cullMode){const rabbit=rabbitById(state.experiments,id);if(!rabbit.stats.alive)return;cullRabbit(state,id);persist();}selectedSubject=id;showUntreated=false;refreshRabbitTrial();});
  refreshRabbitTrial();
}
// Keep the canvas, dose selector, focused button and scroll container alive.
// Replacing the dialog body here used to send mobile players back to its start.
function refreshRabbitTrial() {
  if(currentRoom!=='experiments')return;
  const subject=selectedRabbit(),report=visibleTrial(subject),available=state.pendingBottle?.volume||brew.liquidVolume;
  const reports=state.experiments.records.filter(r=>r.subjectId===subject.id||subject.id==='rabbit-1'&&r.subjectId==='rabbit').slice(0,8);
  $('rabbitName').textContent=subject.name;
  for(const card of $('rabbitSelector').querySelectorAll('[data-subject]')){
    const rabbit=rabbitById(state.experiments,card.dataset.subject),active=rabbit.id===subject.id;
    card.classList.toggle('active',active);card.setAttribute('aria-pressed',String(active));
    card.setAttribute('aria-label',`${cullMode?'Cull':'Select'} ${rabbit.name}, ${rabbit.age}, ${rabbit.location}, ${rabbitCondition(rabbit)}`);
  }
  const doseButton=$('sheetContent').querySelector('[data-test]');doseButton.dataset.test=subject.id;doseButton.textContent=`Give dose · ${subject.name}`;
  const move=$('sheetContent').querySelector('[data-action="move-rabbit"]');move.textContent=subject.location==='cage'?'Return to pen':'Isolate in cage';
  $('sheetContent').querySelector('[data-action="cull-rabbit"]').textContent=`Cull ${subject.name}`;
  $('trialFeedback').textContent=report?`${report.volume.toFixed(1)} ml given · ${report.observations[0]}`:'Choose a dose and watch the rabbit change. Compare with its condition before the dose.';
  $('rabbitNotebook').querySelector('summary').textContent=`Trial observations · ${reports.length} recent doses`;
  $('rabbitTrialNotes').innerHTML=rabbitTrialNotes(reports)||'<p>No observations yet. Start with a fresh adult.</p>';
  $('trialQuantity').textContent=`${available.toFixed(1)} ml available${report?` · ${report.volume.toFixed(1)} ml last dose`:''}`;
  const back=$('trialReturn');back.dataset.action=state.pendingBottle?'return-vial':'close';back.textContent=state.pendingBottle?`Pour back · ${available.toFixed(1)} ml`:'Back to brewing';
  $('sheetContent').querySelector('[data-action="review-vial"]').hidden=!state.pendingBottle;
  $('sheetContent').querySelector('[data-action="potion-id"]').disabled=!observedPotion(state,state.pendingBottle||brew.inspectLiquid());
  $('sheetContent').querySelector('[data-action="pause-trial"]').textContent='Pause view';
  $('sheetContent').querySelector('[data-action="pause-trial"]').setAttribute('aria-pressed','false');
  testingRenderer.replay();testingRenderer.render(subject,report,performance.now(),showUntreated);
  updateRabbitRoom();colonyRenderer.render(state.experiments,subject.id,performance.now(),cullMode);
}
function updateRabbitRoom() {
  if(currentRoom!=='experiments')return;
  const rabbit=selectedRabbit(),alive=state.experiments.rabbits.filter(r=>r.stats.alive),available=state.pendingBottle?.volume||brew.liquidVolume;
  const resting=rabbit.readyAt>Date.now(),b=$('sheetContent').querySelector('[data-test]');if(b)b.disabled=available<1||!rabbit.stats.alive||resting;
  $('trialRest').textContent=!rabbit.stats.alive?'Select a living rabbit':available<1?'Potion used up':resting?`Resting · ${Math.ceil((rabbit.readyAt-Date.now())/1000)}s`:'Ready';
  $('rabbitCondition').textContent=rabbitCondition(rabbit);
  $('rabbitContext').textContent=`${rabbit.age==='baby'?'Baby · fragile; wait for adulthood':'Adult'} · ${rabbit.location==='cage'?'isolated cage':'shared pen'} · ${rabbit.trials} doses received`;
  const report=visibleTrial(rabbit);
  $('trialViewLabel').textContent=!report?'Current condition':showUntreated?'Before dose':'After dose';
  const comparison=$('sheetContent').querySelector('[data-action="untreated"]');
  comparison.disabled=!report;comparison.textContent=report&&showUntreated?'After dose':'Before dose';
  $('sheetContent').querySelector('[data-action="replay-trial"]').disabled=!report;
  $('colonyCount').textContent=`${alive.length} / ${state.experiments.capacity} rabbits`;
  const danger=alive.filter(r=>r.dangerous&&r.location==='pen');
  $('colonyAlerts').textContent=danger.length?`⚠ ${danger.map(r=>r.name).join(', ')} may attack penmates. Isolate or use the cull tool immediately.`:cullMode?'Cull tool active · tap a rabbit to kill it.':'Babies grow into adults over two minutes. Changes and injuries persist.';
  $('colonyAlerts').classList.toggle('danger-alert',danger.length>0);
  const buy=$('sheetContent').querySelector('[data-action="buy-rabbit"]'),price=isSandbox()?0:state.equipment.densimeter?6:8;buy.disabled=alive.length>=state.experiments.capacity||!isSandbox()&&state.coins<price;
  for(const action of ['move-rabbit','cull-rabbit'])$('sheetContent').querySelector(`[data-action="${action}"]`).disabled=!rabbit.stats.alive;
  $('rabbitRecovery').hidden=rabbit.stats.alive;
  const loot=rabbitRemains(rabbit),reagents= {15:'Rabbit Bone',16:'Moon Fur',17:'Cinder Ash',18:'Strange Ichor'};
  $('remainsLoot').textContent=rabbit.remainsRecovered?'Ingredients recovered. The body is cleared; its trial history stays in the notebook.':`Recover once: ${loot.map(d=>`${d.quantity} ${reagents[d.ingredientId]}${d.ingredientId===18?' ml':' measures'}`).join(' · ')}. Grind bones before brewing.`;
  const recover=$('sheetContent').querySelector('[data-action="recover-rabbit"]');recover.disabled=rabbit.stats.alive||rabbit.remainsRecovered;recover.textContent=rabbit.remainsRecovered?'Already recovered':'Recover ingredients';
  for(const r of state.experiments.rabbits){const card=$('sheetContent').querySelector(`[data-subject="${r.id}"]`);if(card){card.querySelector('small').textContent=rabbitCondition(r);card.querySelector('span:nth-of-type(2)').textContent=`${r.age} · ${r.sex==='female'?'♀':'♂'} · ${r.location}`;card.classList.toggle('rabbit-dead',!r.stats.alive);
  }}
  paintRabbitPortraits(performance.now(),true);
  $('colonyJournal').innerHTML=(state.experiments.events||[]).slice(0,12).map(e=>`<li>${escape(e.message||e.text||e.description||e.type)}</li>`).join('')||'<li>The colony is quiet.</li>';
}
let lastRabbitPortraitPaint=-Infinity;
function paintRabbitPortraits(time,force=false) {
  if(currentRoom!=='experiments')return;
  if(!force&&time-lastRabbitPortraitPaint<90)return;
  lastRabbitPortraitPaint=time;
  const paused=testingRenderer?.paused,clock=paused?testingRenderer.frozenAt:time;
  const worldTime=paused?testingRenderer.pausedNow:Date.now();
  const rack=$('rabbitSelector'),bounds=rack?.getBoundingClientRect();if(!bounds)return;
  for(const r of state.experiments.rabbits){
    const portrait=rack.querySelector(`[data-rabbit-portrait="${r.id}"]`);if(!portrait)continue;
    const box=portrait.getBoundingClientRect();
    if(box.right<bounds.left||box.left>bounds.right||box.bottom<0||box.top>innerHeight)continue;
    const signature=`${rabbitArtworkVersion()}:${r.age}:${r.stats.growth}:${r.stats.health}:${r.stats.alive}:${r.trials}:${Number(r.activeFireUntil)>worldTime}:${Object.values(r.exposure).join(',')}:${r.stats.alive?Math.floor(clock/100):0}`;
    if(portrait.dataset.signature!==signature){const ctx=portrait.getContext('2d');ctx.clearRect(0,0,80,60);drawRabbit(ctx,r,40,57,48,clock,{now:worldTime});portrait.dataset.signature=signature;}
  }
}
function testPotion(subjectId) {
  advanceRabbits(state);
  const subject=rabbitById(state.experiments,subjectId);
  if(!subject?.stats.alive||subject.readyAt>Date.now())throw new Error('Choose a living rabbit and let it rest between doses.');
  const preparation=potionRecord(state.pendingBottle||brew.inspectLiquid());
  if(state.pendingBottle){const split=splitPotionSample(state.pendingBottle,testDose);experimentReport=runExperiment(state,split.dose,subjectId,split.dose.volume,Date.now(),preparation);state.pendingBottle=split.remaining;if(!split.remaining)state.stage='brewing';}
  else {if(brew.liquidVolume<1)throw new Error('Prepare a liquid potion first.');const sample=brew.takeSample(testDose);experimentReport=runExperiment(state,sample,subjectId,sample.volume,Date.now(),preparation);}
  state.negotiation=null;latestInspection=preparation;selectedSubject=subject.id;showUntreated=false;
  if(state.tutorial<5)state.tutorial=5;
  audio.play('measure');renderAll();persist();refreshRabbitTrial();
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
  sheet('Settings',`<label class="setting-row">Sound<input id="soundSetting" type="checkbox"${state.settings.sound?' checked':''}></label><label class="setting-row">Graphics<select id="graphicsSetting"><option value="balanced"${state.settings.graphics==='balanced'?' selected':''}>Balanced</option><option value="eco"${state.settings.graphics==='eco'?' selected':''}>Battery saver</option></select></label><div class="action-list"><button data-action="export">Export save</button><button data-action="import">Import save</button><button data-action="tutorial">Tutorial</button><button data-action="menu">Main menu</button></div><input type="file" id="importSaveInput" accept="application/json,.json" class="hidden-input"><details><summary>Brewing guide</summary><p>Grind dry ingredients and stir with water. Gentle warmth helps separate essences blend. Mixing ingredients that activate through heating or cooling can shift the combined activation temperature and unlock powerful effects. Watch all creature responses, compare doses, and write a potion ID. Negotiate a price; refund real faults. An expensive expert seal protects the specific batch against false claims. Garden beds regrow while you are away, with limited harvests and stamina.</p></details>`);
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
  $('sandboxPropertiesBtn').onclick = () => { sandboxInspectorOpen = !sandboxInspectorOpen; syncSandboxInspector(); if (sandboxInspectorOpen) requestAnimationFrame(() => $('sandboxInspector').scrollIntoView({ block: 'nearest', behavior: 'smooth' })); };
  $('sandboxIngredientTab').onclick = () => { sandboxInspectorTab = 'ingredient'; syncSandboxInspector(); };
  $('sandboxMixtureTab').onclick = () => { sandboxInspectorTab = 'mixture'; syncSandboxInspector(); };
  $('sandboxInspectorBody').onchange = event => { if (event.target.id !== 'sandboxInspectIngredient') return; selected = Number(event.target.value); audio.play(); renderRack(); };
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
    if (event.button !== 0 || pointer) return; event.preventDefault(); $('pourBtn').setPointerCapture(event.pointerId);
    stopPour();
    if (pour()) holdTimer = setTimeout(() => { holdInterval = setInterval(() => pour(), 240); }, 420);
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
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 20 && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) {
      const point = renderer.screenToWorld(event.clientX, event.clientY);
      if (insideCauldron(point.x, point.y)) { selected = drag.id; pour(false, point); }
    }
  });
  window.addEventListener('pointercancel', () => { dragged = null; assist = false; pointer = null; stopPour(); });
  $('labCanvas').onpointerdown = event => {
    if (!brew || !state || state.pendingBottle || state.stage !== 'brewing' || $('sheet').open || pointer) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); $('labCanvas').setPointerCapture(event.pointerId);
    const point = renderer.screenToWorld(event.clientX, event.clientY);
    pointer = { id: event.pointerId, point, time: performance.now(),
      startX: event.clientX, startY: event.clientY, moved: false, pouring: false };
    if (tool === 'pestle') { brew.crush(point); renderer.tool = tool; renderer.spoon = point; }
    else if (insideCauldron(point.x, point.y)) {
      stopPour();
      holdTimer = setTimeout(() => {
        if (!pointer || pointer.id !== event.pointerId || pointer.moved || tool === 'pestle') return;
        pointer.pouring = true;
        const pourAtFinger = () => {
          if (!pointer?.pouring) { stopPour(); return; }
          if (insideCauldron(pointer.point.x, pointer.point.y)) pour(false, pointer.point);
        };
        holdInterval = setInterval(pourAtFinger, 240);
        pourAtFinger();
      }, 420);
    }
  };
  $('labCanvas').onpointermove = event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const now = performance.now(), point = renderer.screenToWorld(event.clientX, event.clientY);
    const distance = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
    // Once a hold starts it remains a pouring gesture. Track the finger, pause
    // outside the vessel, and resume on re-entry without accidentally stirring.
    if (pointer.pouring) { pointer.point = point; return; }
    if (!pointer.moved && distance < 10 && tool !== 'pestle') return;
    stopPour();
    const dt = Math.max(.012, Math.min(.1, (now - pointer.time) / 1000));
    if (tool === 'pestle') brew.crush(point);
    else brew.stir(point, { x: (point.x - pointer.point.x) / dt, y: (point.y - pointer.point.y) / dt }, dt, pointer.point);
    renderer.tool = tool; renderer.spoon = point;
    pointer = { ...pointer, point, time: now, moved: true }; advanceTutorial();
  };
  $('labCanvas').addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    stopPour();
    if (tool !== 'pestle' && !pointer.moved && !pointer.pouring &&
        Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 10) {
      const point = renderer.screenToWorld(event.clientX, event.clientY);
      if (insideCauldron(point.x, point.y)) pour(false, point);
    }
    pointer = null; if (renderer) renderer.spoon = null;
  });
  for (const type of ['pointercancel', 'lostpointercapture']) $('labCanvas').addEventListener(type, event => {
    if (pointer?.id === event.pointerId) { stopPour(); pointer = null; }
    if (renderer) renderer.spoon = null;
  });
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
    if (button.dataset.subject) { if(cullMode&&rabbitById(state.experiments,button.dataset.subject)?.stats.alive){cullRabbit(state,button.dataset.subject);persist();} selectedSubject=button.dataset.subject;showUntreated=false;refreshRabbitTrial();return; }
    if (button.dataset.refund || button.dataset.contest) { const claim=resolveComplaint(state,button.dataset.refund||button.dataset.contest,Boolean(button.dataset.contest));renderAll();persist();showReturns();notify(claim.status==='dismissed'?'False claim dismissed by the expert seal.':'Refund settled.');return; }
    if (button.dataset.gather) { startHarvest(button.dataset.gather); return; }

    if (button.dataset.test) { testPotion(button.dataset.test); return; }
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
      case 'compile-id': { const estimates=Object.fromEntries([...$('sheetContent').querySelectorAll('[data-estimate]')].map(input=>[input.dataset.estimate,Number(input.value)/100])); compilePotionId(state,latestInspection,estimates,$('potionName').value,$('potionNotes').value);persist();if(state.pendingBottle)showVial();else {closeSheet();notify('Potion ID compiled. Bottle when ready.');}break; }
      case 'counter-offer': counterOffer(state,Number($('sellerPrice').value));showNegotiation();break;
      case 'accept-offer': finishAgreement();break;
      case 'certify': certifyPotion(state);renderAll();persist();showVial();break;
      case 'returns': showReturns();break;
      case 'harvest': finishHarvest();break;
      case 'buy-rabbit': {const rabbit=buyRabbit(state);selectedSubject=rabbit.id;showUntreated=false;renderAll();persist();showExperiments();notify(`${rabbit.name} has joined the pen.`);break;}
      case 'move-rabbit': {const rabbit=selectedRabbit();moveRabbit(state,rabbit.id,rabbit.location==='cage'?'pen':'cage');persist();refreshRabbitTrial();break;}
      case 'cull-rabbit': cullRabbit(state,selectedRabbit().id);showUntreated=false;persist();refreshRabbitTrial();break;
      case 'recover-rabbit': {const recovered=recoverRabbitIngredients(state,selectedRabbit().id);renderAll();persist();refreshRabbitTrial();notify(`Recovered ${recovered.map(d=>`${d.quantity} ${d.ingredient.name}`).join(', ')}. Ready in your ingredient rack.`);break;}
      case 'cull-tool': cullMode=!cullMode;button.textContent=`Cull tool ${cullMode?'ON':'OFF'}`;button.classList.toggle('cull-active',cullMode);button.setAttribute('aria-pressed',String(cullMode));refreshRabbitTrial();break;
      case 'untreated': showUntreated=!showUntreated;button.textContent=showUntreated?'After dose':'Before dose';button.setAttribute('aria-pressed',String(showUntreated));$('trialViewLabel').textContent=showUntreated?'Before dose':'After dose';break;
      case 'replay-trial': testingRenderer?.replay();showUntreated=false;$('trialViewLabel').textContent='After dose';$('sheetContent').querySelector('[data-action="untreated"]').textContent='Before dose';$('sheetContent').querySelector('[data-action="untreated"]').setAttribute('aria-pressed','false');$('sheetContent').querySelector('[data-action="pause-trial"]').textContent='Pause';$('sheetContent').querySelector('[data-action="pause-trial"]').setAttribute('aria-pressed','false');break;
      case 'pause-trial': {const paused=testingRenderer?.togglePause();button.textContent=paused?'Resume view':'Pause view';button.setAttribute('aria-pressed',String(paused));break;}
      case 'return-vial': {const volume=returnVialToCauldron(state,brew);latestInspection=null;closeSheet();renderAll();persist();audio.play('pour');notify(`${volume.toFixed(1)} ml returned. Adjust, then test the new batch.`);break;}
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
  if(state&&inShop&&!document.hidden&&now-lastRabbitTick>1000){lastRabbitTick=now;const count=state.experiments.rabbits.length,events=advanceRabbits(state);if(events?.length){persist();if(currentRoom==='experiments'&&count!==state.experiments.rabbits.length)showExperiments();}updateRabbitRoom();if(now-lastAutosave>8000)persist();}
  if(currentRoom==='experiments'&&testingRenderer&&!document.hidden){const subject=selectedRabbit(),report=visibleTrial(subject);testingRenderer.render(subject,report,now,showUntreated);colonyRenderer?.render(state.experiments,subject.id,now,cullMode,testingRenderer.paused);paintRabbitPortraits(now);}
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
