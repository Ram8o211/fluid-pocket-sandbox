import { Phase } from '../simulation/Phase.mjs';
import { CAULDRON_NATIVE_INTERIOR, PARTICLE_ML } from './cauldron.mjs';
import { LiquidFunSolids } from './LiquidFunSolids.mjs';

/**
 * Adapter for Google's actual LiquidFun 1.1.0 Emscripten-generated JavaScript.
 * LiquidFun owns hydrodynamics and the solid bodies touching those liquids.
 * The game's ParticleSystem remains authoritative for identity, quantities,
 * thermal state, phases, reactions, magical effects, glow and saved potions.
 * The old 3D sandbox does not need to load this separate 2D cauldron engine.
 */
export class LiquidFunFluid {
  constructor(runtime = globalThis) {
    const required = ['b2World', 'b2Vec2', 'b2BodyDef', 'b2EdgeShape',
      'b2ParticleSystemDef', 'b2ParticleGroupDef', 'b2PolygonShape'];
    if (required.some(name => typeof runtime[name] !== 'function'))
      throw new Error('Google LiquidFun runtime has not loaded.');
    this.r = runtime;
    this.world = new runtime.b2World(new runtime.b2Vec2(0, -4.5));
    // The upstream wrapper allocates these two scratch buffers per world but
    // provides no JS destructor. Remember them for explicit session disposal.
    this.scratchPointers = [runtime._transBuf?.byteOffset, runtime._vec2Buf?.byteOffset];
    this.scratchBuffers = { transform: runtime._transBuf, vector: runtime._vec2Buf };
    // Upstream lfjs fixture bindings resolve this global for their lookup.
    runtime.world = this.world;
    const pot = this.world.CreateBody(new runtime.b2BodyDef());
    for (let i = 0; i < CAULDRON_NATIVE_INTERIOR.length; i++) {
      const a = CAULDRON_NATIVE_INTERIOR[i], b = CAULDRON_NATIVE_INTERIOR[(i + 1) % CAULDRON_NATIVE_INTERIOR.length];
      const edge = new runtime.b2EdgeShape();
      edge.Set(new runtime.b2Vec2(a[0], a[1]), new runtime.b2Vec2(b[0], b[1]));
      pot.CreateFixtureFromShape(edge, 0);
    }
    this.definition = new runtime.b2ParticleSystemDef();
    // Keep liquid area unchanged despite representing more ml per particle.
    // Finer saved parcels recover their smaller radius from current volume.
    this.definition.radius = .039 * Math.sqrt(PARTICLE_ML / .25);
    this.definition.destroyByAge = false;
    // Suppress residual energy in a settled pool without damping deliberate
    // spoon strokes or a newly poured stream at the game layer.
    this.definition.dampingStrength = .55;
    this.definition.pressureStrength = .12;
    this.definition.viscousStrength = .14;
    // The tensile particle flag acts like a spring across the surface: its
    // repeated restoring impulses made an otherwise still pool oscillate.
    // Water pressure and viscosity are enough for non-elastic liquid motion.
    this.definition.surfaceTensionNormalStrength = 0;
    this.definition.surfaceTensionPressureStrength = 0;
    this.definition.staticPressureStrength = .28;
    this.definition.staticPressureIterations = 6;
    this.system = this.world.CreateParticleSystem(this.definition);
    this.solids = new LiquidFunSolids(runtime, this.world);
    this.indices = [];
    this.frames = 0;
    this.rebuilds = 0;
    this.disposed = false;
  }
  allocate(count) {
    if (!count) return;
    // The official CreateParticle scalar binding passes stack addresses as
    // group/userData pointers, corrupting flags and deleting/reordering parcels.
    // Its bulk shape binding correctly initializes real groups. Seed an exact
    // count on a unit lattice, then replace all coordinates before any Step.
    const columns = Math.min(count, 48), rows = Math.floor(count / columns);
    const remainder = count % columns;
    const seed = (width, height) => {
      const def = new this.r.b2ParticleGroupDef();
      def.flags = (this.r.b2_waterParticle || 0) | (this.r.b2_viscousParticle || 0)
        | (this.r.b2_staticPressureParticle || 0);
      def.stride = 1;
      const shape = new this.r.b2PolygonShape();
      shape.vertices = [[-.25, -.25], [width - .75, -.25],
        [width - .75, height - .75], [-.25, height - .75]]
        .map(([x, y]) => new this.r.b2Vec2(x, y));
      def.shape = shape;
      const group = this.system.CreateParticleGroup(def);
      if (group.GetParticleCount() !== width * height)
        throw new Error('LiquidFun particle allocation failed.');
    };
    seed(columns, rows);
    if (remainder) seed(remainder, 1);
  }
  buffers(count) {
    const position = this.system.GetPositionBuffer(), velocity = this.system.GetVelocityBuffer();
    // These views use the real native count. Upstream GetParticleCount() doubles
    // it; extending a short view hides particle loss and reads unrelated memory.
    if (position.length !== count * 2 || velocity.length !== count * 2)
      throw new Error('LiquidFun particle buffers lost alignment.');
    return { position, velocity };
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
    this.allocate(indices.length);
    this.indices = indices;
    this.rebuilds++;
  }
  step(ps, dt, gravity) {
    if (this.disposed) throw new Error('LiquidFun session has been disposed.');
    this.r.world = this.world;
    this.r._transBuf = this.scratchBuffers.transform; this.r._vec2Buf = this.scratchBuffers.vector;
    this.particlesPS = ps;
    this.synchronize(ps);
    this.solids.synchronize(ps);
    this.world.SetGravity(new this.r.b2Vec2(gravity.x, gravity.y));
    const indices = this.indices, count = indices.length;
    // A partial vial drains mass from every parcel without removing indices.
    // Native systems have one radius: scale it by mean parcel area so the
    // remaining liquid shrinks physically as well as in the inventory/renderer.
    let volume = 0;
    for (const i of indices) volume += ps.mixtureAmount?.[i] ?? PARTICLE_ML;
    const radius = count ? this.definition.radius * Math.sqrt(Math.max(.0001, volume / count) / PARTICLE_ML) : this.definition.radius;
    ps.nativeLiquidRadius = count ? radius : 0;
    if (typeof this.system.SetRadius === 'function' && Math.abs(radius - this.system.radius) > .000001)
      this.system.SetRadius(radius);
    let { position, velocity } = this.buffers(count);
    // External impulses (spoon, density buoyancy, collisions) are already
    // stored in the game's velocities. Reuse them directly in the native solve.
    for (let k = 0; k < count; k++) {
      const i = indices[k], j = k * 2;
      ps.px[i] = ps.x[i]; ps.py[i] = ps.y[i];
      position[j] = ps.x[i]; position[j + 1] = ps.y[i];
      velocity[j] = ps.vx[i]; velocity[j + 1] = ps.vy[i];
    }
    // The 40 Hz game/chemistry clock is too coarse for native pressure in a
    // full bowl. Integrate the SAME elapsed time in small native steps; fast
    // spoon strokes get extra CFL headroom without changing their impulse.
    let maxSpeed = 0;
    for (const i of indices) maxSpeed = Math.max(maxSpeed, Math.hypot(ps.vx[i], ps.vy[i]));
    for (let i = 0; i < ps.count; i++) if (ps.phase[i] === Phase.SOLID)
      maxSpeed = Math.max(maxSpeed, Math.hypot(ps.vx[i], ps.vy[i]));
    this.substeps = Math.min(4, Math.max(1, Math.ceil(dt * 80 - 1e-8),
      Math.ceil(maxSpeed * dt / Math.max(.001, radius * 1.5))));
    for (let substep = 0; substep < this.substeps; substep++)
      this.world.Step(dt / this.substeps, 6, 3);
    this.solids.readback(ps);
    ({ position, velocity } = this.buffers(count));
    for (let k = 0; k < count; k++) {
      const i = indices[k], j = k * 2;
      if (!Number.isFinite(position[j]) || !Number.isFinite(position[j + 1])
        || !Number.isFinite(velocity[j]) || !Number.isFinite(velocity[j + 1]))
        throw new Error('LiquidFun non-finite parcel ' + JSON.stringify({
          index:i, step:this.frames, count, x:position[j], y:position[j+1],
          vx:velocity[j], vy:velocity[j+1], sourceX:ps.x[i], sourceY:ps.y[i],
          phase:ps.phase[i], inputVX:ps.vx[i], inputVY:ps.vy[i],
          nativeCount:position.length / 2, positionLength:position.length,
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
    this.r.world = this.world;
    this.solids.reset();
    if (this.particlesPS) this.particlesPS.nativeLiquidRadius = 0;
    this.indices.length = 0;
    this.world.DestroyParticleSystem(this.system);
    this.system = this.world.CreateParticleSystem(this.definition);
    this.frames = 0;
  }
  dispose() {
    if (this.disposed) return;
    this.r.world = this.world;
    this.solids.reset();
    const module = this.r.Module;
    if (typeof module?._b2World_Delete === 'function') {
      module._b2World_Delete(this.world.ptr);
      for (const pointer of this.scratchPointers) if (pointer) module._free(pointer);
    } else this.world.DestroyParticleSystem(this.system);
    if (this.r.world === this.world) this.r.world = null;
    this.indices.length = 0;
    if (this.particlesPS) this.particlesPS.nativeLiquidRadius = 0;
    this.disposed = true;
  }
}
