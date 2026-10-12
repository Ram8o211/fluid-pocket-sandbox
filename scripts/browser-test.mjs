import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { Phase } from '../src/simulation/Phase.mjs';

// Both local and live verification drive visible controls. A throw fails CI.
// Save reads are assertions and deterministic test guidance, never state writes.
const live = process.env.SITE_URL;
const base = live ? new URL(live).href : 'http://127.0.0.1:4176/fluid-pocket-sandbox/';
const server = live ? null : spawn(process.execPath, ['scripts/dev-server.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: '4176', BASE_PATH: '/fluid-pocket-sandbox' } });
let browser;
const errors = [], failedResponses = [];
const timeout = 15000;
async function readSave(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('alchemists-shop-save'))); }
async function clickDose(page, amount) {
  await page.locator(`[data-dose="${amount}"]`).click();
}
async function pourRecipe(page, recipe) {
  for (const portion of recipe.portions) {
    await page.locator(`[data-ingredient="${portion.ingredientId}"]`).click();
    // The first two orders use 20 ml increments. Subsequent generation and
    // difficult thermal witnesses are covered by physics integration tests.
    assert.equal(portion.ml % 20, 0);
    await clickDose(page, 20);
    for (let ml = 0; ml < portion.ml; ml += 20) await page.locator('#pourBtn').click();
  }
}
async function bottleAndSell(page) {
  await page.locator('#bottleBtn').click();
  await page.locator('[data-action="sell"]').waitFor({ timeout });
  assert.match(await page.locator('.score').textContent(), /\d+/);
  await page.locator('[data-action="sell"]').click();
  await page.locator('[data-action="next"]').waitFor({ timeout });
}
try {
  if (server) {
    for (let i = 0; i < 30; i++) { try { if ((await fetch(base)).ok) break; } catch { /* Server startup. */ } await sleep(100); }
  }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) failedResponses.push(response.url()); });
  await page.goto(base); await page.waitForSelector('body[data-game-ready="true"]', { timeout });
  assert.equal(await page.title(), "The Alchemist's Shop");
  const styled = await page.locator('#newWorldBtn').evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(styled, 'rgba(0, 0, 0, 0)');
  await page.locator('#worldSeed').fill('mobile-acceptance'); await page.locator('#newWorldBtn').click();
  await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  const initial = await readSave(page); assert.equal(initial.coins, 80); assert.equal(initial.world.ingredients.filter(i => i.starter).length, 6);
  await pourRecipe(page, initial.order.witness); await page.waitForTimeout(550);
  assert.match(await page.locator('#volume').textContent(), /60 \/ 60/);
  // Hold-assisted stirring and a real circular spoon gesture.
  const stir = await page.locator('#stirBtn').boundingBox();
  await page.mouse.move(stir.x + stir.width / 2, stir.y + stir.height / 2); await page.mouse.down(); await page.waitForTimeout(450); await page.mouse.up();
  const bowl = await page.locator('#labCanvas').boundingBox();
  const cx = bowl.x + bowl.width / 2, cy = bowl.y + bowl.height * .72;
  await page.mouse.move(cx + 25, cy); await page.mouse.down();
  for (let i = 1; i <= 18; i++) await page.mouse.move(cx + Math.cos(i / 18 * Math.PI * 2) * 25, cy + Math.sin(i / 18 * Math.PI * 2) * 17, { steps: 2 });
  await page.mouse.up();
  await page.locator('#heatBtn').click(); await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) await page.locator('#heatBtn').click();
  await page.locator('#coolBtn').click(); await page.waitForTimeout(250);
  for (let i = 0; i < 3; i++) await page.locator('#coolBtn').click();
  await page.locator('#measureBtn').click();
  assert.match(await page.locator('#sheetContent').textContent(), /60 ml|60\.0 ml/);
  assert.match(await page.locator('#sheetContent').textContent(), /°A/);
  const activeSave = await readSave(page);
  assert.equal(activeSave.brew.count, 240); assert.equal(activeSave.brew.particleMl, .25);
  assert.match(await page.locator('#labStatus').textContent(), /SEALED/);
  assert.ok(activeSave.brew.history.stirred > 0); assert.ok(activeSave.brew.history.heatEnergy > 0); assert.ok(activeSave.brew.history.coldEnergy > 0);
  await page.locator('[data-action="save-inspection"]').click(); await page.locator('#discoveryName').fill('First travelling tonic'); await page.locator('[data-action="record-discovery"]').click();
  assert.match(await page.locator('#sheetContent').textContent(), /First travelling tonic/);
  await page.locator('[data-action="close"]').click();
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/mobile-workshop.png', fullPage: true });
  await bottleAndSell(page); const firstSale = await readSave(page);
  assert.equal(firstSale.completed, 1); assert.ok(firstSale.coins > initial.coins); assert.ok(firstSale.lastSale.quality >= 90); assert.equal(firstSale.pendingBottle, null);
  assert.equal(firstSale.discoveries.length, 1); assert.ok(firstSale.inventory[1] < initial.inventory[1]);
  await page.screenshot({ path: 'test-results/customer-sale.png', fullPage: true });
  await page.locator('[data-action="next"]').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  await page.locator('#upgradesBtn').click(); await page.locator('[data-upgrade="0"]').click(); await page.locator('[data-action="close"]').click();
  const second = await readSave(page); assert.ok(second.equipment.densimeter);
  await pourRecipe(page, second.order.witness); await page.waitForTimeout(550); await bottleAndSell(page);
  const twoSales = await readSave(page); assert.equal(twoSales.completed, 2); assert.ok(twoSales.lastSale.quality >= 95);
  await page.locator('[data-action="next"]').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  await page.locator('#pourBtn').click(); const beforeReload = await readSave(page); assert.equal(beforeReload.brew.count, 80);
  await page.reload(); await page.locator('#continueBtn').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  const afterReload = await readSave(page); assert.equal(afterReload.completed, 2); assert.equal(afterReload.brew.count, 80); assert.deepEqual(afterReload.inventory, beforeReload.inventory); assert.ok(afterReload.equipment.densimeter);
  // Mobile overflow and main controls at narrow widths; desktop shares the game.
  for (const viewport of [{ width: 320, height: 740 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal viewport overflow');
    assert.ok(await page.locator('#bottleBtn').isVisible());
  }
  await page.setViewportSize({ width: 393, height: 852 });
  // Genuine TouchEvents delivered through Chromium's mobile input path.
  const touch = await context.newCDPSession(page), rect = await page.locator('#labCanvas').boundingBox();
  const tx = rect.x + rect.width / 2, ty = rect.y + rect.height * .72;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx + 28, y: ty - 18 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.locator('#measureBtn').click(); assert.match(await page.locator('#sheetContent').textContent(), /Density/); await page.locator('[data-action="close"]').click();
  // Stop applying impulses and let gravity collect the small batch. Persist via
  // the visible menu so this assertion reads the actual simulated resting state.
  await page.waitForTimeout(2200); await page.locator('#menuBtn').click();
  const settledSave = await readSave(page);
  const settledY = settledSave.brew.particles.y.slice().sort((a, b) => a - b);
  assert.ok(settledY.reduce((sum, y) => sum + y, 0) / settledY.length < -.75, 'Liquid should pool at the bottom');
  assert.ok(settledY[Math.floor(settledY.length * .95)] < -.55, 'Idle liquid must not hang in mid-air');
  await page.locator('#continueBtn').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  const resumed = await readSave(page);
  const resumedY = resumed.brew.particles.y.slice().sort((a, b) => a - b);
  assert.ok(resumedY[Math.floor(resumedY.length * .95)] < -.55, 'Continue should preserve the settled physical state');
  await page.screenshot({ path: 'test-results/settled-liquid.png', fullPage: true });
  // A real small batch boils through visible controls. The lid keeps its mass,
  // warns the player, and blocks bottling until cooling completes the phase loop.
  const massBeforeBoiling = beforeReload.brew.particles.mass.reduce((sum, mass) => sum + mass, 0);
  await page.locator('#heatBtn').click();
  await page.waitForFunction(() => /ML STEAM/.test(document.querySelector('#labStatus').textContent), null, { timeout });
  assert.equal(await page.locator('#bottleBtn').isDisabled(), true);
  assert.match(await page.locator('#bottleBtn').textContent(), /Wait for condensation/);
  assert.match(await page.locator('#labHint').textContent(), /Steam is trapped/);
  // Continue heating until the actual persisted vapour reaches the lid. This
  // catches a dense cloud that has lost its lift despite still being labelled gas.
  await page.waitForFunction(gasPhase => {
    const particles = JSON.parse(localStorage.getItem('alchemists-shop-save'))?.brew?.particles;
    return particles?.phase.some((phase, i) => phase === gasPhase && particles.y[i] > .8 && particles.localGasDensity[i] > 0);
  }, Phase.GAS, { timeout });
  await page.screenshot({ path: 'test-results/retained-steam.png', fullPage: true });
  await page.locator('#coolBtn').click();
  await page.waitForFunction(() => !/ML STEAM/.test(document.querySelector('#labStatus').textContent), null, { timeout });
  for (let i = 0; i < 3; i++) await page.locator('#coolBtn').click();
  const condensed = await readSave(page);
  assert.equal(condensed.brew.history.evaporated, 0); assert.ok(condensed.brew.history.condensed > 0);
  assert.ok(Math.abs(condensed.brew.particles.mass.reduce((sum, mass) => sum + mass, 0) - massBeforeBoiling) < .001);
  assert.deepEqual(condensed.inventory, beforeReload.inventory);
  assert.doesNotMatch(await page.locator('#bottleBtn').textContent(), /Wait for condensation/);
  await page.screenshot({ path: 'test-results/condensed-brew.png', fullPage: true });
  // Freeze a real batch, then crush a touched portion using the visible pestle.
  for (let i = 0; i < 3; i++) await page.locator('#coolBtn').click();
  await page.waitForFunction(solid => JSON.parse(localStorage.getItem('alchemists-shop-save'))?.brew?.particles?.phase.some(p => p === solid), Phase.SOLID, { timeout: 20000 });
  await page.locator('#crushBtn').click();
 …19169 tokens truncated…r)ps.vz[i]+=kick(3)*amplitude;
      }
      const damping=Math.exp(-dt*(ps.phase[i]===Phase.GAS?.15:.025));ps.vx[i]*=damping;ps.vy[i]*=damping;ps.vz[i]*=damping;
      const speed2=ps.vx[i]*ps.vx[i]+ps.vy[i]*ps.vy[i]+(planar?0:ps.vz[i]*ps.vz[i]);if(speed2>maxV*maxV){const k=maxV/Math.sqrt(speed2);ps.vx[i]*=k;ps.vy[i]*=k;if(!planar)ps.vz[i]*=k;}
      ps.x[i]+=ps.vx[i]*dt;ps.y[i]+=ps.vy[i]*dt;if(planar){ps.z[i]=0;ps.vz[i]=0;}else ps.z[i]+=ps.vz[i]*dt;
    }
    this.collideBox(ps,env.box,planar);
    collideBoundary?.();
    const r2=searchRadius*searchRadius;
    for(let it=0;it<iterations;it++){
      grid.rebuild(ps,env.box);this.gasCounts.fill(0,0,ps.count);
      grid.forEachPair(ps,searchRadius,(i,j)=>{
        const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d2=dx*dx+dy*dy+dz*dz;if(d2<=1e-12||d2>r2)return;const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,nz=planar?0:dz/d,pi=ps.phase[i],pj=ps.phase[j];
        // Vapour parcels represent overlapping gas volumes, not hard spheres.
        // Only very close contacts separate, with a time-scaled soft response.
        if(pi===Phase.GAS&&pj===Phase.GAS){
          const contact=particlePairRestDistance(ps,i,j,planar)*(env.gasContactScale??.55);
          if(d<contact){const q=1-d/contact,amount=q*q*(env.gasContactStrength??.12)*dt/Math.max(1,iterations);separatePair(ps,i,j,nx,ny,nz,amount,planar);}
          this.gasCounts[i]=Math.min(65535,this.gasCounts[i]+pairStride);this.gasCounts[j]=Math.min(65535,this.gasCounts[j]+pairStride);return;
        }
        if(pi===Phase.GAS||pj===Phase.GAS){
          const gas=pi===Phase.GAS?i:j,sign=pi===Phase.GAS?-1:1,contact=particlePairRestDistance(ps,i,j,planar)*.7;
          if(d<contact){const q=1-d/contact,spread=q*q*.24*dt/Math.max(1,iterations);ps.x[gas]+=nx*spread*sign;ps.y[gas]+=ny*spread*sign;if(!planar)ps.z[gas]+=nz*spread*sign;}return;
        }
        if(pi===Phase.LIQUID&&pj===Phase.LIQUID){this.solveLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,dt,planar,interactionScale);return;}
        if(pi===Phase.SOLID&&pj===Phase.SOLID){this.solveSolidPair(ps,i,j,nx,ny,nz,d,dt,planar);return;}
        if(pi===Phase.SOLID&&pj===Phase.LIQUID){this.solveSolidLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,planar);return;}
        if(pi===Phase.LIQUID&&pj===Phase.SOLID)this.solveSolidLiquidPair(ps,j,i,-nx,-ny,-nz,d,gravity,rules,planar);
      },pairStride,(pairPhase+it)%pairStride);
      if(hasHard){grid.rebuild(ps,env.box);this.enforceHardPacking(ps,grid,searchRadius,planar);}
      for(let i=0;i<ps.count;i++)ps.localGasDensity[i]=ps.phase[i]===Phase.GAS?clamp(.18+this.gasCounts[i]*.075,0,1.8):0;
      this.collideBox(ps,env.box,planar);
      collideBoundary?.();
    }
    for(let i=0;i<ps.count;i++){
      const rx=(ps.x[i]-ps.px[i])/dt,ry=(ps.y[i]-ps.py[i])/dt,rz=planar?0:(ps.z[i]-ps.pz[i])/dt;
      if(ps.phase[i]===Phase.SOLID){if(planar)ps.vz[i]=0;}
      else{
        const liquid=ps.phase[i]===Phase.LIQUID,freezing=liquid&&ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0;
        // Dense packing moves positions to remove overlaps. Feeding all of that
        // correction into velocity can launch fine liquids off a supporting
        // floor every frame. Retain physical gravity, spoon and contact momentum
        // while allowing a bounded contribution from constraint displacement.
        const constraintShare=liquid?clamp(env.liquidConstraintVelocityShare??1,0,1):clamp(env.gasConstraintVelocityShare??.1,0,1),physicalShare=Math.max(freezing*.94,1-constraintShare);
        const physicalDown=ps.vx[i]*gravity.x+ps.vy[i]*gravity.y+ps.vz[i]*gravity.z;
        ps.vx[i]=rx*(1-physicalShare)+ps.vx[i]*physicalShare;ps.vy[i]=ry*(1-physicalShare)+ps.vy[i]*physicalShare;ps.vz[i]=planar?0:rz*(1-physicalShare)+ps.vz[i]*physicalShare;
        if(liquid&&constraintShare<1&&physicalDown>=0){
          const projectedDown=rx*gravity.x+ry*gravity.y+rz*gravity.z;
          if(projectedDown<physicalDown){
            // Supporting liquid/floor contacts arrest downward motion; they do
            // not turn falling momentum into a new upward launch. Use the
            // supported displacement directly, avoiding hidden falling speed
            // inside a stationary packed layer. Spoon-driven rising remains free.
            const gravity2=gravity.x*gravity.x+gravity.y*gravity.y+gravity.z*gravity.z;
            if(gravity2>1e-8){const currentDown=ps.vx[i]*gravity.x+ps.vy[i]*gravity.y+ps.vz[i]*gravity.z,k=(Math.max(0,projectedDown)-currentDown)/gravity2;ps.vx[i]+=gravity.x*k;ps.vy[i]+=gravity.y*k;if(!planar)ps.vz[i]+=gravity.z*k;}
          }
        }
      }
    }
  }
  collideBox(ps,box,planar=false){
    for(let i=0;i<ps.count;i++){
      const pad=clamp(effectiveParticleRadius(ps,i,planar)*.62,.05,.16),hx=box.width/2-pad,hy=box.height/2-pad,hz=box.depth/2-pad;
      const solid=ps.phase[i]===Phase.SOLID,granular=solid&&ps.solidSubdivision[i]>.45,restitution=solid?0:.08,tangent=solid?(granular?.48:.72):.92;let hitX=false,hitY=false,hitZ=false;
      if(ps.x[i]<-hx){ps.x[i]=-hx;if(ps.vx[i]<0)ps.vx[i]=-ps.vx[i]*restitution;hitX=true;}else if(ps.x[i]>hx){ps.x[i]=hx;if(ps.vx[i]>0)ps.vx[i]=-ps.vx[i]*restitution;hitX=true;}
      if(ps.y[i]<-hy){ps.y[i]=-hy;if(ps.vy[i]<0)ps.vy[i]=-ps.vy[i]*restitution;hitY=true;}else if(ps.y[i]>hy){ps.y[i]=hy;if(ps.vy[i]>0)ps.vy[i]=-ps.vy[i]*restitution;hitY=true;}
      if(planar){ps.z[i]=0;ps.vz[i]=0;}else if(ps.z[i]<-hz){ps.z[i]=-hz;if(ps.vz[i]<0)ps.vz[i]=-ps.vz[i]*restitution;hitZ=true;}else if(ps.z[i]>hz){ps.z[i]=hz;if(ps.vz[i]>0)ps.vz[i]=-ps.vz[i]*restitution;hitZ=true;}
      if(hitX){ps.vy[i]*=tangent;ps.vz[i]*=tangent;}if(hitY){ps.vx[i]*=tangent;ps.vz[i]*=tangent;if(granular&&Math.abs(ps.vy[i])<.18)ps.vy[i]=0;}if(hitZ){ps.vx[i]*=tangent;ps.vy[i]*=tangent;}
    }
  }
}

