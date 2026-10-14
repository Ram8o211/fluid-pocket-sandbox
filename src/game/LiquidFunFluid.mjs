import { Phase } from '../simulation/Phase.mjs';
import { CAULDRON_INTERIOR } from './cauldron.mjs';

/**
 * Adapter for Google's actual LiquidFun 1.1.0 Emscripten-generated JavaScript.
 * LiquidFun owns only the hydrodynamic position/velocity solve for liquids.
 * The game's ParticleSystem remains authoritative for identity, quantities,
 * thermal state, phases, reactions, magical effects, glow and saved potions.
 * The old 3D sandbox does not need to load this separate 2D cauldron engine.
 */
export class LiquidFunFluid {
  constructor(runtime = globalThis) {
    const required = ['b2World', 'b2Vec2', 'b2BodyDef', 'b2EdgeShape',
      'b2ParticleSystemDef', 'b2ParticleDef'];
    if (required.some(name => typeof runtime[name] !== 'function'))
      throw new Error('Google LiquidFun runtime has not loaded.');
    this.r = runtime;
    this.world = new runtime.b2World(new runtime.b2Vec2(0, -4.5));
    // Upstream lfjs fixture bindings resolve this global for their lookup.
    runtime.world = this.world;
    const pot = this.world.CreateBody(new runtime.b2BodyDef());
    for (let i = 0; i < CAULDRON_INTERIOR.length; i++) {
      const a = CAULDRON_INTERIOR[i], b = CAULDRON_INTERIOR[(i + 1) % CAULDRON_INTERIOR.length];
      const edge = new runtime.b2EdgeShape();
      edge.Set(new runtime.b2Vec2(a[0], a[1]), new runtime.b2Vec2(b[0], b[1]));
      pot.CreateFixtureFromShape(edge, 0);
    }
    this.definition = new runtime.b2ParticleSystemDef();
    // Fine 2D parcels fit a full 440ml cauldron without artificial packing.
    this.definition.radius = .039;
    this.definition.destroyByAge = false;
    this.definition.dampingStrength = .17;
    this.definition.pressureStrength = .12;
    this.definition.viscousStrength = .33;
    this.definition.surfaceTensionNormalStrength = .16;
    this.definition.surfaceTensionPressureStrength = .12;
    this.definition.staticPressureStrength = .28;
    this.definition.staticPressureIterations = 6;
    this.system = this.world.CreateParticleSystem(this.definition);
    this.indices = [];
    this.frames = 0;
    this.rebuilds = 0;
  }
  /** Keep actual LiquidFun particle indices aligned to the current packed
   * game arrays after pours, spills, phase changes and bottling/removal.
   * The material/magic arrays are never copied into LiquidFun or destroyed.
   */
  synchronize(ps) {
    const indices = [];
    for (let i = 0; i < ps.count; i++) if (ps.phase[i] === Phase.LIQUID) indices.push(i);
    const old = this.indices;
    const changed = old.length !== indices.length || indices.some((i, n) => i !== old[n]);
    if (!changed) return;
    this.world.DestroyParticleSystem(this.system);
    this.system = this.world.CreateParticleSystem(this.definition);
    // The upstream self-contained testbed API omits SetMaxParticleCount;
    // allocation still grows dynamically when this helper is absent.
    if (typeof this.system.SetMaxParticleCount === 'function')
      this.system.SetMaxParticleCount(ps.capacity);
    const def = new this.r.b2ParticleDef();
    // Upstream b2ParticleDef initializes color as b2Vec2; replace it with
    // its actual b2ParticleColor to avoid undefined channel values in C++.
    if (typeof this.r.b2ParticleColor === 'function')
      def.color = new this.r.b2ParticleColor(255, 255, 255, 255);
    // No built-in color mixing: magical colors belong to the game's live
    // chemical channels, not to the physical engine's particle pigments.
    def.flags = this.r.b2_waterParticle;
    for (const i of indices) {
      def.position.Set(ps.x[i], ps.y[i]);
      def.velocity.Set(ps.vx[i], ps.vy[i]);
      const id = this.system.CreateParticle(def);
      if (id < 0) throw new Error('LiquidFun particle allocation failed.');
    }
    this.indices = indices;
    this.rebuilds++;
  }
  step(ps, dt, gravity) {
    this.synchronize(ps);
    this.world.SetGravity(new this.r.b2Vec2(gravity.x, gravity.y));
    const indices = this.indices, count = indices.length;
    if (!count) { this.frames++; return; }
    let position = this.system.GetPositionBuffer();
    let velocity = this.system.GetVelocityBuffer();
    if (position.length !== count * 2 || velocity.length !== count * 2)
      throw new Error('LiquidFun particle buffers lost alignment.');
    // External impulses (spoon, density buoyancy, collisions) are already
    // stored in the game's velocities. Reuse them directly in the native solve.
    for (let k = 0; k < count; k++) {
      const i = indices[k], j = k * 2;
      ps.px[i] = ps.x[i]; ps.py[i] = ps.y[i];
      position[j] = ps.x[i]; position[j + 1] = ps.y[i];
      velocity[j] = ps.vx[i]; velocity[j + 1] = ps.vy[i];
    }
    this.world.Step(dt, 6, 3);
    position = this.system.GetPositionBuffer();
    velocity = this.system.GetVelocityBuffer();
    // Some upstream Emscripten testbed builds expose only half the active
    // position-buffer view after their first Step. Their native storage still
    // owns the full float2 array, so extend the typed view, never copy from
    // undefined values or drop/misidentify ingredient parcels.
    if (position.length < count * 2)
      position = new Float32Array(position.buffer, position.byteOffset, count * 2);
    if (velocity.length < count * 2)
      velocity = new Float32Array(velocity.buffer, velocity.byteOffset, count * 2);
    for (let k = 0; k < count; k++) {
      const i = indices[k], j = k * 2;
      if (!Number.isFinite(position[j]) || !Number.isFinite(position[j + 1])
        || !Number.isFinite(velocity[j]) || !Number.isFinite(velocity[j + 1]))
        throw new Error('LiquidFun non-finite parcel ' + JSON.stringify({
          index:i, step:this.frames, count, x:position[j], y:position[j+1],
          vx:velocity[j], vy:velocity[j+1], sourceX:ps.x[i], sourceY:ps.y[i],
          phase:ps.phase[i], inputVX:ps.vx[i], inputVY:ps.vy[i],
          nativeCount:this.system.GetParticleCount(), positionLength:position.length,
          velocityLength:velocity.length,
          finite:{x:Number.isFinite(position[j]),y:Number.isFinite(position[j+1]),
            vx:Number.isFinite(velocity[j]),vy:Number.isFinite(velocity[j+1])}
        }));
      ps.x[i] = position[j]; ps.y[i] = position[j + 1];
      ps.vx[i] = velocity[j]; ps.vy[i] = velocity[j + 1];
    }
    this.frames++;
  }
  reset() {
    this.indices.length = 0;
    this.world.DestroyParticleSystem(this.system);
    this.system = this.world.CreateParticleSystem(this.definition);
    this.frames = 0;
  }
}
