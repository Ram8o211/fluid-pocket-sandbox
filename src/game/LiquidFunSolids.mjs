import { Phase } from '../simulation/Phase.mjs';
import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';

// Transport changes these fields by tiny amounts every tick. Recreating a
// collider for each change invalidates native contact/TOI caches across a whole
// powder pile. Bound the drift from the actual fixture, not from the last tick.
// A 0.5% radius change is below 0.02 pixels at the cauldron's native resolution.
export const NATIVE_SOLID_SHAPE_TOLERANCE = Object.freeze({ radius: .005, density: .01 });

/** Pressure startup may remove an overlap, but must not turn that correction
 * into kinetic energy. Keep physical input speed (including gravity/tools),
 * with a sub-parcel position relaxation and no added pressure-startup energy. */
export function readNativeMotion(ps, i, x, y, vx, vy, dt, gravity, relaxing) {
  let limited = false;
  if (relaxing) {
    const speed = Math.hypot(vx, vy);
    const limit = Math.hypot(ps.vx[i] + gravity.x * dt, ps.vy[i] + gravity.y * dt);
    if (speed > limit) { vx *= limit / speed; vy *= limit / speed; limited = true; }
    const dx = x - ps.x[i] - vx * dt, dy = y - ps.y[i] - vy * dt;
    const distance = Math.hypot(dx, dy), correction = .6 * dt;
    if (distance > correction) {
      limited = true;
      x = ps.x[i] + vx * dt + dx * correction / distance;
      y = ps.y[i] + vy * dt + dy * correction / distance;
    }
  }
  ps.x[i] = x; ps.y[i] = y; ps.vx[i] = vx; ps.vy[i] = vy;
  return limited;
}

// The cauldron must resolve water and solid contacts in the same world. Moving
// liquid parcels out of a block after native pressure has run compresses their
// neighbours and feeds a fresh pressure explosion back into the next tick.
// Mirror coherent blocks as compound bodies and loose grains as single bodies;
// identity, crushing, melting, chemistry and saved quantities stay in the game.
export class LiquidFunSolids {
  constructor(runtime, world) {
    this.r = runtime; this.world = world; this.bodies = new Map();
    this.supported = typeof runtime.b2CircleShape === 'function';
    this.motion = { x: [0], y: [0], vx: [0], vy: [0] };
    this.groups = new Map();
    this.vector = new runtime.b2Vec2();
  }
  remove(record) {
    for (const fixture of record.body.fixtures) delete this.world.fixturesLookup[fixture.ptr];
    this.world.DestroyBody(record.body);
  }
  synchronize(ps) {
    if (!this.supported) return;
    const groups = this.groups;
    for (const indices of groups.values()) indices.length = 0;
    for (let i = 0; i < ps.count; i++) {
      if (ps.phase[i] !== Phase.SOLID) continue;
      const key = ps.solidSubdivision[i] < .55 && ps.solidBodyId[i] > 0 ? ps.solidBodyId[i] : -i - 1;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    for (const [key, indices] of groups) if (!indices.length) groups.delete(key);
    for (const [key, record] of this.bodies) if (!groups.has(key)) {
      this.remove(record); this.bodies.delete(key);
    }
    for (const [key, indices] of groups) {
      let x = 0, y = 0, vx = 0, vy = 0, mass = 0;
      let record = this.bodies.get(key);
      let changed = !record || record.indices.length !== indices.length;
      let moved = changed || record.needsMotionSync, accelerated = moved;
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        const m = ps.mass[i]; mass += m;
        x += ps.x[i] * m; y += ps.y[i] * m; vx += ps.vx[i] * m; vy += ps.vy[i] * m;
        const radius = ps.frozenRadius?.[i] || effectiveParticleRadius(ps, i, true);
        if (!changed && (record.indices[k] !== i || record.lastMass[k] !== m
          || Math.abs(record.radii[k] - radius) > Math.max(.00001, record.radii[k] * NATIVE_SOLID_SHAPE_TOLERANCE.radius)
          || Math.abs(record.densities[k] - ps.density[i]) > Math.max(.0001, record.densities[k] * NATIVE_SOLID_SHAPE_TOLERANCE.density))) changed = true;
        if (!moved && (record.lastX[k] !== ps.x[i] || record.lastY[k] !== ps.y[i] || record.lastMass[k] !== m)) moved = true;
        if (!accelerated && (record.lastVX[k] !== ps.vx[i] || record.lastVY[k] !== ps.vy[i] || record.lastMass[k] !== m)) accelerated = true;
      }
      x /= mass; y /= mass; vx /= mass; vy /= mass;
      // Quantities can shrink without losing an index when a vial is sampled.
      if (changed) {
        if (record) this.remove(record);
        const def = new this.r.b2BodyDef();
        def.type = this.r.b2_dynamicBody; def.fixedRotation = true;
        def.position = new this.r.b2Vec2(x, y);
        def.linearDamping = .25;
        const body = this.world.CreateBody(def);
        const offsets = [], radii = [], densities = [];
        for (const i of indices) {
          const ox = ps.x[i] - x, oy = ps.y[i] - y;
          offsets.push({ x: ox, y: oy });
          const shape = new this.r.b2CircleShape();
          shape.position = new this.r.b2Vec2(ox, oy);
          shape.radius = ps.frozenRadius?.[i] || effectiveParticleRadius(ps, i, true);
          radii.push(shape.radius); densities.push(ps.density[i]);
          const fixture = new this.r.b2FixtureDef();
          fixture.shape = shape; fixture.density = Math.max(.04, ps.density[i]);
          fixture.friction = .6; fixture.restitution = 0;
          body.CreateFixtureFromDef(fixture);
        }
        record = { body, indices: indices.slice(), offsets, radii, densities,
          lastX: new Float32Array(indices.length), lastY: new Float32Array(indices.length),
          lastVX: new Float32Array(indices.length), lastVY: new Float32Array(indices.length), lastMass: new Float32Array(indices.length) };
        this.bodies.set(key, record);
      }
      // A redundant SetTransform invalidates native contact/TOI caches and
      // SetLinearVelocity wakes resting grains. Leave native motion alone when
      // the game has not changed the exact Float32 values we last published.
      // Tools, confinement, phase changes and partial bottling still hand off
      // their changes immediately; no tolerance can hide a small real stroke.
      if (changed || moved) {
        this.vector.x = x; this.vector.y = y; record.body.SetTransform(this.vector, 0);
      }
      if (changed || accelerated) {
        this.vector.x = vx; this.vector.y = vy; record.body.SetLinearVelocity(this.vector);
      }
      record.x = x; record.y = y; record.vx = vx; record.vy = vy;
    }
  }
  readback(ps, dt, gravity, relaxing) {
    let limited = false;
    for (const record of this.bodies.values()) {
      const { body, indices, offsets } = record;
      let x, y, vx, vy;
      const module = this.r.Module, buffer = this.r._vec2Buf;
      if (buffer && typeof module?._b2Body_GetPosition === 'function' && typeof module?._b2Body_GetLinearVelocity === 'function') {
        const floats = module.HEAPF32, index = buffer.byteOffset >>> 2;
        module._b2Body_GetPosition(body.ptr, buffer.byteOffset); x = floats[index]; y = floats[index + 1];
        module._b2Body_GetLinearVelocity(body.ptr, buffer.byteOffset); vx = floats[index]; vy = floats[index + 1];
      } else {
        const point = body.GetPosition(), velocity = body.GetLinearVelocity();
        x = point.x; y = point.y; vx = velocity.x; vy = velocity.y;
      }
      const motion = this.motion;
      motion.x[0] = record.x; motion.y[0] = record.y; motion.vx[0] = record.vx; motion.vy[0] = record.vy;
      // A coherent body relaxes once at its centre, preserving every offset.
      const bodyLimited = readNativeMotion(motion, 0, x, y, vx, vy, dt, gravity, relaxing);
      record.needsMotionSync = bodyLimited;
      limited = bodyLimited || limited;
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        ps.x[i] = motion.x[0] + offsets[k].x; ps.y[i] = motion.y[0] + offsets[k].y;
        ps.vx[i] = motion.vx[0]; ps.vy[i] = motion.vy[0];
        record.lastX[k] = ps.x[i]; record.lastY[k] = ps.y[i];
        record.lastVX[k] = ps.vx[i]; record.lastVY[k] = ps.vy[i]; record.lastMass[k] = ps.mass[i];
        // Native friction/sleep owns dry support; don't cancel the next native
        // contact with stale legacy granular rest flags.
        ps.grainRest[i] = 0;
      }
    }
    return limited;
  }
  reset() {
    for (const record of this.bodies.values()) this.remove(record);
    this.bodies.clear();
    this.groups.clear();
  }
}
