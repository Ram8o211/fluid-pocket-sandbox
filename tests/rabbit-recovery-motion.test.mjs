import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, availableIngredients } from '../src/game/world.mjs';
import { newShop, restock } from '../src/game/economy.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { cullRabbit, moveRabbit, recoverRabbitIngredients, rabbitRemains, assessRabbitEffects, createRabbitColony } from '../src/game/rabbits.mjs';
import { rabbitMotion, rabbitColonyPoses } from '../src/game/RabbitMotion.mjs';
import { drawRabbit, RabbitColonyRenderer } from '../src/game/RabbitRenderer.mjs';
import { encodeSave, decodeSave } from '../src/game/persistence.mjs';

const setup = () => {
  const state = newShop(generateWorld('remains-and-hops'));
  const brew = new BrewingSession(state.world.ingredients, state.equipment);
  return { state, brew, rabbit: state.experiments.rabbits[0] };
};

test('recover once, persist the harvest and brew it into an existing cauldron', () => {
  const { state, brew, rabbit } = setup();
  brew.pour(1, 20, state.inventory);
  const waterMass = brew.engine.ps.totalMass(), initialWorld = state.world.ingredients.length;
  assert.throws(() => recoverRabbitIngredients(state, rabbit.id), /dead rabbit/);
  cullRabbit(state, rabbit.id);
  const drops = recoverRabbitIngredients(state, rabbit.id);
  assert.deepEqual(drops.map(d => [d.ingredientId,d.quantity]), [[15,4],[16,3]]);
  assert.equal(state.world.ingredients.length, initialWorld + 2);
  assert.ok(availableIngredients(state.world,state.equipment).some(i => i.id === 15));
  assert.equal(state.inventory[15],4);assert.equal(state.inventory[16],3);
  assert.equal(brew.pour(15, 4, state.inventory, { crushed:true }),4);
  assert.equal(state.inventory[15],0);
  assert.ok(brew.engine.ps.totalMass()>waterMass);
  assert.ok(brew.engine.materials.has(15), 'new stock is usable in an already open brew');
  const restored = decodeSave(encodeSave(state, brew));
  const recovered = restored.experiments.rabbits[0];
  assert.equal(recovered.remainsRecovered,true);assert.equal(recovered.stats.alive,false);
  assert.equal(restored.inventory[16],3);
  const before = JSON.stringify(restored);
  assert.throws(() => recoverRabbitIngredients(restored, recovered.id), /already/);
  assert.equal(JSON.stringify(restored),before);
  assert.throws(() => restock(restored,15,20), /fallen rabbits/);
});

test('burned, dissolved, corroded, altered and infant remains give finite appropriate ingredients', () => {
  const { rabbit } = setup();
  const death = effects => assessRabbitEffects({stability:100,...effects},rabbit,20).afterRabbit;
  assert.deepEqual(rabbitRemains(death({fire:1})),[{ingredientId:17,quantity:4}]);
  assert.deepEqual(rabbitRemains(death({acidity:1})),[{ingredientId:18,quantity:2}]);
  const altered=death({poison:1});
  assert.ok(rabbitRemains(altered).some(d=>d.ingredientId===18));
  altered.exposure.acidity=1.5;
  assert.deepEqual(rabbitRemains(altered),[{ingredientId:15,quantity:1},{ingredientId:18,quantity:2}]);
  altered.age='baby';assert.ok(rabbitRemains(altered).every(d=>d.quantity===1));
});

test('a body stays in its cage until recovered and can never be moved by a cage swap', () => {
  const { state, rabbit } = setup();
  moveRabbit(state,rabbit.id,'cage');cullRabbit(state,rabbit.id);
  const other=state.experiments.rabbits[1];
  assert.throws(()=>moveRabbit(state,other.id,'cage'),/Recover the remains/);
  assert.equal(rabbit.location,'cage');assert.equal(other.location,'pen');
  recoverRabbitIngredients(state,rabbit.id);moveRabbit(state,other.id,'cage');
  assert.equal(other.location,'cage');assert.equal(rabbit.location,'cage');
  assert.ok(!rabbitColonyPoses(state.experiments.rabbits).some(p=>p.rabbit.id===rabbit.id));
});

test('each rabbit makes bounded hops with landings, sniffing and grazing instead of drifting in a grid', () => {
  // Waypoints depend on the birth-time mutation seed. Keep coverage independent
  // of the runner's clock while retaining all distance and activity assertions.
  const state={experiments:createRabbitColony(1000)},rabbit=state.experiments.rabbits[0];rabbit.bornAt=0;
  const activities=new Set(),positions=new Set();let before=null;
  for(let time=0;time<60000;time+=50){
    const pose=rabbitMotion(rabbit,time);
    assert.ok(pose.x>=63&&pose.x<=373&&pose.y>=155&&pose.y<=260);
    activities.add(pose.activity);positions.add(`${pose.x},${pose.y}`);
    if(before)assert.ok(Math.hypot(pose.x-before.x,pose.y-before.y)<10,'no teleport when a new path begins');
    before=pose;
  }
  assert.deepEqual(activities,new Set(['hop','sniff','graze']));assert.ok(positions.size>100);
  const original=structuredClone(state.experiments.rabbits);
  rabbitColonyPoses(state.experiments.rabbits,5000);
  assert.deepEqual(state.experiments.rabbits,original,'visual navigation does not mutate potion state');
});

test('dead positions and pixels stay completely still even with love, poison or acid exposure', () => {
  const { state, rabbit } = setup();rabbit.bornAt=0;rabbit.exposure.love=2;rabbit.exposure.acidity=.6;
  cullRabbit(state,rabbit.id,4321);
  assert.deepEqual(rabbitMotion(rabbit,5000),rabbitMotion(rabbit,999999));
  const pixels=time=>{
    const result=[];
    const ctx={fillStyle:'',save(){},restore(){},translate(x,y){result.push(['t',x,y]);},scale(x,y){result.push(['s',x,y]);},fillRect(x,y,w,h){result.push([x,y,w,h,this.fillStyle]);}};
    drawRabbit(ctx,rabbit,200,280,192,time,{now:time});return result;
  };
  assert.deepEqual(pixels(5000),pixels(100000));
  const colony=rabbitColonyPoses(state.experiments.rabbits,9000);
  assert.deepEqual(colony.find(p=>p.rabbit.id===rabbit.id),rabbitColonyPoses(state.experiments.rabbits,10000).find(p=>p.rabbit.id===rabbit.id));
});
