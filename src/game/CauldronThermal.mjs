import { clamp } from '../simulation/math.mjs';
import { ROOM_TEMPERATURE } from './contracts.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { cauldronBottomContact, cauldronParticlePadding } from './cauldron.mjs';

const FLOOR_CAPACITY = .75, LID_CAPACITY = .45;

/** Finite copper reservoirs: source -> lower bowl -> neighbours. The lid warms
 * through the copper and can exchange heat in either direction with its fluid.
 * With both sources off, copper and contents gradually approach room temperature;
 * crowding never removes heat from an otherwise hot patch of trapped steam. */
export class CauldronThermal {
  constructor() { this.reset(); this.exchange = new Float64Array(0); }
  reset() { this.floor = this.lid = ROOM_TEMPERATURE; }
  step(ps, power, dt) {
    const before = this.floor;
    this.floor = clamp(this.floor + power * dt / FLOOR_CAPACITY, .01, 1.2);
    const supplied = (this.floor - before) * FLOOR_CAPACITY;
    // With either source running, the enclosed pot eventually equilibrates.
    // With both off, the copper slowly releases energy to the room.
    if (!power) {
      const fraction = 1 - Math.exp(-.38 * dt);
      this.floor += (ROOM_TEMPERATURE - this.floor) * fraction;
      this.lid += (ROOM_TEMPERATURE - this.lid) * fraction;
    }
    const copperEnergy = (this.floor - this.lid) * FLOOR_CAPACITY * LID_CAPACITY
      / (FLOOR_CAPACITY + LID_CAPACITY) * (1 - Math.exp(-1.8 * dt));
    this.floor -= copperEnergy / FLOOR_CAPACITY;
    this.lid += copperEnergy / LID_CAPACITY;
    this.exchangeWall(ps, 'floor', FLOOR_CAPACITY, dt);
    // Active Frost enters through the lower bowl. A chilled copper lid must
    // not start a second freezing front at the top of the liquid. Passive lid
    // condensation and heat exchange resume normally when Frost is off.
    const lidEnergy = this.exchangeWall(ps, 'lid', LID_CAPACITY, dt, power >= 0);
    return { supplied, lidCooling: Math.max(0, lidEnergy) };
  }
  exchangeWall(ps, wall, capacity, dt, allowCooling = true) {
    if (this.exchange.length < ps.capacity) this.exchange = new Float64Array(ps.capacity);
    const temperature = this[wall];
    let contactCapacity = 0, energy = 0;
    for (let i = 0; i < ps.count; i++) {
      const gap = 1.2 - ps.y[i] - cauldronParticlePadding(ps, i);
      const contact = wall === 'floor' ? cauldronBottomContact(ps, i) : clamp(1 - gap / .12, 0, 1);
      const c = Math.max(.00001, ps.mass[i] * ps.heatCapacity[i]);
      const fraction = 1 - Math.exp(-contact * Math.max(0, ps.thermalConductivity[i]) * 32 * dt);
      this.exchange[i] = (allowCooling || ps.phase[i] === Phase.GAS ? temperature - ps.temperature[i] : Math.max(0, temperature - ps.temperature[i])) * c * fraction;
      contactCapacity += c * fraction;
    }
    // Shared finite wall energy cannot be spent independently for every parcel.
    const scale = Math.min(1, capacity / Math.max(.00001, contactCapacity));
    for (let i = 0; i < ps.count; i++) {
      const transferred = this.exchange[i] * scale;
      ps.temperature[i] += transferred / Math.max(.00001, ps.mass[i] * ps.heatCapacity[i]);
      energy += transferred;
    }
    this[wall] = clamp(temperature - energy / capacity, .01, 1.2);
    return -energy;
  }
  snapshot() { return { floor: this.floor, lid: this.lid }; }
  restore(saved, ps) {
    if (saved) {
      if (![saved.floor, saved.lid].every(t => Number.isFinite(t) && t >= .01 && t <= 1.2)) throw new Error('Invalid saved cauldron temperature.');
      this.floor = saved.floor; this.lid = saved.lid;
    } else {
      let energy = 0, capacity = 0;
      for (let i = 0; i < ps.count; i++) { const c = ps.mass[i] * ps.heatCapacity[i]; energy += ps.temperature[i] * c; capacity += c; }
      this.floor = this.lid = capacity > 0 ? clamp(energy / capacity, .01, 1.2) : ROOM_TEMPERATURE;
    }
  }
}
