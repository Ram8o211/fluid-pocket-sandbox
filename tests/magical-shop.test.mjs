import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/game/world.mjs';
import { newShop, completeSale } from '../src/game/economy.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';
import { compilePotionId, findPotionId, potionFingerprint } from '../src/game/potionId.mjs';
import { runExperiment, resetExperimentSubject } from '../src/game/experiments.mjs';
import { startNegotiation, counterOffer, acceptCustomerOffer, certifyPotion, certificationCost, advanceComplaints, resolveComplaint, certificateFor, recordDelivery } from '../src/game/commerce.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { encodeSave, decodeSave } from '../src/game/persistence.mjs';
import { gatherIngredient, resourceStatus, gardenStamina, tendGarden } from '../src/game/gathering.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { MixtureSolver } from '../src/reactions/MixtureSolver.mjs';
import { stepArcana, warmedMiscibility } from '../src/simulation/ArcaneSolver.mjs';

const world = generateWorld('magical-contracts');
const baseline = newShop(world,{now:100000});
function shop() { return structuredClone(baseline); }
function sample(state, extras={}) {
  const effects=Object.fromEntries(EFFECT_PROPERTIES.map(k=>[k,0]));
  for(const r of state.order.requirements) if(r.comparison!=='maximum') effects[r.property]=r.target;
  return { id:'vial', batchId:crypto.randomUUID(), volume:state.order.volume, mass:state.order.volume, density:1,color:'#9acbcc', temperature:.33,
    liquidFraction:1, stability:100, cost:{ingredients:3,energy:0}, history:{}, portions:[{ingredientId:1,ml:50},{ingredientId:2,ml:10,crushed:true}], composition:{1:50,2:10},...effects,...extras };
}
function identify(state,vial,estimates={}) {
  runExperiment(state,vial,'rabbit',5,100000);
  return compilePotionId(state,vial,{...Object.fromEntries(EFFECT_PROPERTIES.map(k=>[k,vial[k]])),...estimates},'My observation');
}

test('the potion ID stores the player’s guesses and exact batch, never an automatic assay',()=>{
  const state=shop(),vial=sample(state);
  assert.throws(()=>compilePotionId(state,vial,Object.fromEntries(EFFECT_PROPERTIES.map(k=>[k,0]))),/Observe/);
  const document=identify(state,vial,{strength:.61});assert.equal(document.estimates.strength,.61);assert.notEqual(document.estimates.strength,vial.strength);
  assert.equal(findPotionId(state,{...vial,volume:40}).id,document.id);
  assert.equal(findPotionId(state,{...vial,strength:vial.strength+.00005}).id,document.id,'sub-visible settling must not erase a written estimate');
  assert.equal(findPotionId(state,{...vial,batchId:crypto.randomUUID()}),null);
  assert.equal(findPotionId(state,{...vial,strength:vial.strength+.02}),null);
});
test('counteroffers, acceptance, delivery and receipt survive saving without duplicate sales',()=>{
  const state=shop(),vial=sample(state);state.pendingBottle=vial;state.stage='inspection';identify(state,vial);
  assert.throws(()=>completeSale(state),/Agree/);
  const first=startNegotiation(state).offer;
  counterOffer(state,state.order.budget*2);assert.ok(state.negotiation.offer>first);assert.equal(state.negotiation.agreed,false);
  const offer=state.negotiation.offer;acceptCustomerOffer(state);
  const restored=decodeSave(encodeSave(state,new BrewingSession(world.ingredients)));
  const sale=completeSale(restored);assert.equal(sale.payment,offer);assert.equal(restored.deliveries.length,1);assert.equal(restored.pendingBottle,null);
  assert.throws(()=>completeSale(restored));assert.equal(restored.completed,1);
});
test('bargaining responds to claimed effects and does not reveal actual effectiveness',()=>{
  const good=shop(),bad=shop(),a=sample(good),b=sample(bad,{strength:0});
  good.pendingBottle=a;bad.pendingBottle=b;
  identify(good,a,{strength:.2});identify(bad,b,{strength:.2});
  assert.equal(startNegotiation(good).offer,startNegotiation(bad).offer);
  for(let i=0;i<4;i++)counterOffer(good,good.order.budget*2);
  assert.throws(()=>counterOffer(good,good.order.budget*2),/final offer/);
  assert.equal(startNegotiation(good).round,4,'reopening cannot reset patience');
});
test('genuine complaints are mandatory even for certified potions, with debt for shortfalls',()=>{
  const state=shop(),vial=sample(state,{strength:0});state.pendingBottle=vial;identify(state,vial);state.coins=500;certifyPotion(state);
  const receipt=recordDelivery(state,{payment:47},vial,state.order,100000);assert.ok(receipt.genuine);
  advanceComplaints(state,receipt.dueAt);const claim=state.complaints[0];assert.equal(claim.status,'pending');
  state.coins=5;resolveComplaint(state,claim.id,true);assert.equal(claim.status,'refunded');assert.equal(state.coins,0);assert.equal(state.debt,42);
  assert.throws(()=>resolveComplaint(state,claim.id));
});
test('a costly exact-batch seal defeats a bluff, while ignorance or dismissal cannot evade a refund',()=>{
  const state=shop(),vial=sample(state);state.pendingBottle=vial;identify(state,vial);state.coins=500;
  const before=state.coins,seal=certifyPotion(state);assert.equal(before-state.coins,certificationCost(state));
  assert.equal(certifyPotion(state).id,seal.id);assert.equal(before-state.coins,seal.cost);
  assert.equal(certificateFor(state,{...vial,batchId:'different'}),null);
  assert.equal(certificateFor(state,{...vial,love:.1}),null);
  const receipt=recordDelivery(state,{payment:38},vial,state.order,100000);receipt.bluff=true;receipt.genuine=false;receipt.met=true;
  advanceComplaints(state,receipt.dueAt);const claim=state.complaints[0],coins=state.coins;
  resolveComplaint(state,claim.id,true);assert.equal(claim.status,'dismissed');assert.equal(state.coins,coins);
  const unsealed=shop(),other=sample(unsealed);identify(unsealed,other);const r=recordDelivery(unsealed,{payment:38},other,unsealed.order,100000);r.bluff=true;r.genuine=false;r.met=true;
  advanceComplaints(unsealed,r.dueAt);advanceComplaints(unsealed,r.dueAt+61000);assert.equal(unsealed.complaints[0].status,'refunded');assert.equal(unsealed.coins,42);
});
test('real side effects cause returns and offline deadlines persist',()=>{
  const state=shop(),vial=sample(state,{poison:.9});state.pendingBottle=vial;identify(state,vial);state.stage='inspection';
  const receipt=recordDelivery(state,{payment:20},vial,state.order,100000);assert.ok(receipt.sideEffects.includes('poison'));
  advanceComplaints(state,receipt.dueAt);
  const resumed=decodeSave(encodeSave(state,new BrewingSession(world.ingredients)));
  advanceComplaints(resumed,receipt.dueAt+70000);assert.equal(resumed.complaints[0].status,'refunded');assert.equal(resumed.coins,60);
});
test('harvesting requires timing and stamina, is bounded offline, and tending spends water',()=>{
  const precise=shop(),rough=shop(),node=precise.foraging.nodes.find(n=>n.ingredientId===2);
  const a=gatherIngredient(precise,node.id,50,100000,{precision:1});const b=gatherIngredient(rough,node.id,50,100000,{precision:0});
  assert.equal(a.quantity,10);assert.equal(b.quantity,4);assert.equal(a.remaining,10);assert.equal(gardenStamina(precise,100000),88);
  precise.inventory[1]=20;tendGarden(precise,node.id,100000);assert.equal(precise.inventory[1],15);
  assert.throws(()=>tendGarden(precise,node.id,100001),/already/);
  assert.equal(resourceStatus(precise,node.id,100000+node.regrowMs*100).available,node.capacity);
  precise.inventory[2]=72;assert.throws(()=>gatherIngredient(precise,node.id,10,100000+node.regrowMs),/jar is full/);
  precise.inventory[2]=0;precise.foraging.stamina=0;precise.foraging.staminaAt=100000;assert.throws(()=>gatherIngredient(precise,node.id,10,100000),/Rest/);
});
test('warmth makes normally separating essences soluble and overheating erodes magic',()=>{
  const ps=new ParticleSystem(2);const make=(id,threshold,strength)=>sanitizeMaterial({id,name:'essence',color:'#8aba98',arcaneThreshold:threshold,strength,magicDecayTemperature:.75,miscibility:.4});
  ps.add({x:0,y:0,z:0},make(1,8,.8));ps.add({x:.05,y:0,z:0},make(2,-8,.2));
  const ambient=warmedMiscibility(ps,0,1,.12,{heatSolubility:.95});ps.temperature.fill(.8);assert.ok(warmedMiscibility(ps,0,1,.12,{heatSolubility:.95})>ambient+.4);
  const before=ps.strength[0];ps.arcaneConverted.fill(1);for(let i=0;i<40;i++)stepArcana(ps,.025);assert.ok(ps.strength[0]<before);assert.equal(ps.arcaneConverted[0],1);
});
test('opposed unreachable awakening runes mix to a reachable threshold independently of phase points',()=>{
  const ps=new ParticleSystem(2);const make=(id,threshold)=>sanitizeMaterial({id,name:'essence',color:'#c199bb',density:1,strength:.4,love:.3,arcaneThreshold:threshold,meltingTemperature:.05,boilingTemperature:1.05});
  ps.add({x:0,y:0,z:0},make(1,4));ps.add({x:.05,y:0,z:0},make(2,-2.8));
  const solver=new MixtureSolver(),rules={baseMixingRate:100,mixingExponent:1,mixingTemperatureCoefficient:0};
  for(let i=0;i<30;i++){solver.beginFrame(ps);solver.contact(ps,0,1,1,.2,.1,rules);solver.finishFrame(ps,rules,.1);}
  assert.ok(Math.abs(ps.arcaneThreshold[0]-.6)<.001);assert.equal(ps.arcaneConverted[0],0);
  ps.temperature.fill(.8);for(let i=0;i<20;i++)stepArcana(ps,.025);
  assert.equal(ps.arcaneConverted[0],1);assert.ok(ps.strength[0]>.97);assert.ok(ps.love[0]<.003);
  const stable=ps.strength[0];ps.temperature.fill(.33);stepArcana(ps,.025);assert.equal(ps.strength[0],stable);
  const brew=new BrewingSession(world.ingredients);brew.pour(13,5,{13:10});brew.engine.ps.arcaneConverted[0]=1;
  const restored=new BrewingSession(world.ingredients);restored.restore(brew.snapshot());assert.equal(restored.engine.ps.arcaneConverted[0],1);assert.equal(potionFingerprint(sample(shop())).length>0,true);
});

 test('mandatory refunds cannot lock an apprentice out of further research',()=>{
  const state=shop();state.coins=0;state.debt=12;state.experiments.subjects.rabbit.stats.alive=false;
  resetExperimentSubject(state,'rabbit');assert.ok(state.experiments.subjects.rabbit.stats.alive);assert.equal(state.coins,0);assert.equal(state.debt,15);
});
