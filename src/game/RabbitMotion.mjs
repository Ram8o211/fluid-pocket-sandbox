// Seeded waypoints and discrete hops. Use world time so reopening a panel does
// not reset a rabbit, and a corpse always resolves to the instant of its death.
const randomAt = (seed, index) => {
  let value = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return ((value ^ value >>> 15) >>> 0) / 4294967296;
};
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

export function rabbitMotion(rabbit, now = Date.now()) {
  const seed = Number(rabbit.mutation?.seed) || Number(String(rabbit.id).replace(/\D/g, '')) || 1;
  const alive = rabbit.stats?.alive !== false;
  const clock = alive ? now : rabbit.deathAt || rabbit.bornAt;
  const cycleMs = 11500 + Math.floor(randomAt(seed, 1) * 3500);
  const elapsed = Math.max(0, clock - (rabbit.bornAt || 0)) + randomAt(seed, 2) * cycleMs;
  const cycle = Math.floor(elapsed / cycleMs), phase = elapsed % cycleMs;
  const cage = rabbit.location === 'cage';
  const waypoint = index => ({ x: cage ? 502 + randomAt(seed, index * 2 + 10) * 58 : 63 + randomAt(seed, index * 2 + 10) * 310,
    y: cage ? 265 + randomAt(seed, index * 2 + 11) * 10 : 155 + randomAt(seed, index * 2 + 11) * 105 });
  const start = waypoint(cycle), end = waypoint(cycle + 1);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const hops = Math.max(1, Math.ceil(distance / (cage ? 13 : 23)));
  const hopMs = 600, moveMs = hops * hopMs;
  const hopping = phase < moveMs;
  const local = hopping ? phase / hopMs % 1 : 1;
  // A brief landing between every two jumps, rather than continuous sliding.
  const flight = Math.min(1, local / .74), eased = flight * flight * (3 - 2 * flight);
  const travel = hopping ? (Math.floor(phase / hopMs) + eased) / hops : 1;
  const x = start.x + (end.x - start.x) * travel, y = start.y + (end.y - start.y) * travel;
  const frost = Math.min(1, (rabbit.exposure?.freeze || 0) / 4);
  const tired = Math.min(1, (rabbit.exposure?.poison || 0) / 1.25);
  const activity = !alive ? 'still' : hopping ? 'hop' : phase < moveMs + 2000 ? 'sniff' : 'graze';
  return { x: Math.round(x), y: Math.round(y), facing: end.x >= start.x ? 1 : -1, activity,
    hop: alive && hopping ? Math.round(Math.sin(flight * Math.PI) * (cage ? 2 : 5) * (1 - frost * .8) * (1 - tired * .5)) : 0,
    gait: alive && hopping ? Math.floor(flight * 3) : 0 };
}

/** Soft personal space: moving rabbits yield to resting rabbits and bodies.
 * The dead never take part in the displacement, even in a crowded pen. */
export function rabbitColonyPoses(rabbits, now = Date.now()) {
  const poses = rabbits.filter(rabbit => !rabbit.remainsRecovered).map(rabbit => ({ rabbit, ...rabbitMotion(rabbit, now) }));
  for (const pose of poses) {
    if (!pose.rabbit.stats.alive || pose.activity !== 'hop') continue;
    let dx = 0, dy = 0;
    for (const other of poses) {
      if (other === pose || other.rabbit.location !== pose.rabbit.location) continue;
      const gapX = pose.x - other.x, gapY = (pose.y - other.y) * 1.5, distance = Math.hypot(gapX, gapY);
      if (distance >= 36) continue;
      const push = (36 - distance) * .35;
      dx += distance > .01 ? gapX / distance * push : pose.rabbit.id > other.rabbit.id ? push : -push;
      dy += distance > .01 ? gapY / distance * push / 1.5 : 0;
    }
    const cage = pose.rabbit.location === 'cage';
    pose.x = Math.round(clamp(pose.x + dx, cage ? 495 : 63, cage ? 570 : 373));
    pose.y = Math.round(clamp(pose.y + dy, cage ? 265 : 155, cage ? 280 : 260));
  }
  return poses;
}
