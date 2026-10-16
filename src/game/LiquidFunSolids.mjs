import { Phase } from '../simulation/Phase.mjs';
import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';

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
  }
  remove(record) {
    for (const fixture of record.body.fixtures) delete this.world.fixturesLookup[fixture.ptr];
    this.world.DestroyBody(record.body);
  }
  synchronize(ps) {
    if (!this.supported) return;
    const groups = new Map();
    for (let i = 0; i < ps.count; i++) {
      if (ps.phase[i] !== Phase.SOLID) continue;
      const key = ps.solidSubdivision[i] < .55 && ps.solidBodyId[i] > 0 ? ps.solidBodyId[i] : -i - 1;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    for (const [key, record] of this.bodies) if (!groups.has(key)) {
      this.remove(record); this.bodies.delete(key);
    }
    for (const [key, indices] of groups) {
      let x = 0, y = 0, vx = 0, vy = 0, mass = 0;
      for (const i of indices) {
        const m = ps.mass[i]; mass += m;
        x += ps.x[i] * m; y += ps.y[i] * m; vx += ps.vx[i] * m; vy += ps.vy[i] * m;
      }
      x /= mass; y /= mass; vx /= mass; vy /= mass;
      // Quantities can shrink without losing an index when a vial is sampled.
      const signature = indices.map(i => `${i}:${(ps.frozenRadius?.[i] || effectiveParticleRadius(ps, i, true)).toFixed(5)}:${ps.density[i].toFixed(4)}`).join('|');
      let record = this.bodies.get(key);
      if (record?.signature !== signature) {
        if (record) this.remove(record);
        const def = new this.r.b2BodyDef();
        def.type = this.r.b2_dynamicBody; def.fixedRotation = true;
        def.position = new this.r.b2Vec2(x, y);
        def.linearDamping = .25;
        const body = this.world.CreateBody(def);
        const offsets = [];
        for (const i of indices) {
          const ox = ps.x[i] - x, oy = ps.y[i] - y;
          offsets.push({ x: ox, y: oy });
          const shape = new this.r.b2CircleShape();
          shape.position = new this.r.b2Vec2(ox, oy);
          shape.radius = ps.frozenRadius?.[i] || effectiveParticleRadius(ps, i, true);
          const fixture = new this.r.b2FixtureDef();
          fixture.shape = shape; fixture.density = Math.max(.04, ps.density[i]);
          fixture.friction = .6; fixture.restitution = 0;
          body.CreateFixtureFromDef(fixture);
        }
        record = { body, indices, offsets, signature };
        this.bodies.set(key, record);
      }
      record.body.SetTransform(new this.r.b2Vec2(x, y), 0);
      record.body.SetLinearVelocity(new this.r.b2Vec2(vx, vy));
      record.x = x; record.y = y; record.vx = vx; record.vy = vy;
    }
  }
  readback(ps, dt, gravity, relaxing) {
    let limited = false;
    for (const record of this.bodies.values()) {
      const { body, indices, offsets } = record;
      const point = body.GetPosition(), velocity = body.GetLinearVelocity();
      const motion = this.motion;
      motion.x[0] = record.x; motion.y[0] = record.y; motion.vx[0] = record.vx; motion.vy[0] = record.vy;
      // A coherent body relaxes once at its centre, preserving every offset.
      limited = readNativeMotion(motion, 0, point.x, point.y, velocity.x, velocity.y, dt, gravity, relaxing) || limited;
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        ps.x[i] = motion.x[0] + offsets[k].x; ps.y[i] = motion.y[0] + offsets[k].y;
        ps.vx[i] = motion.vx[0]; ps.vy[i] = motion.vy[0];
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
  }
}
