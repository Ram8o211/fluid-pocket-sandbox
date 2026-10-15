import { drawPixelRabbit as drawRabbit } from './RabbitPixelArt.mjs';
import { rabbitColonyPoses } from './RabbitMotion.mjs';
import { rabbitArtworkVersion } from './RabbitAssets.mjs';
// Rabbit anatomy is drawn from the accumulated dose, rather than choosing a
// sprite for the most recent potion. Every mark and mutation has a stable seed.
const lerp = (a, b, t) => a + (b - a) * t;
const randomAt = (seed, index) => {
  let result = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  result = Math.imul(result ^ result >>> 16, 0x21f0aaad);
  result = Math.imul(result ^ result >>> 15, 0x735a2d97);
  return ((result ^ result >>> 15) >>> 0) / 4294967296;
};

function oval(ctx, x, y, rx, ry, fill) {
  ctx.fillStyle = fill;
  for(let row=-Math.round(ry);row<=ry;row++) {
    const half=Math.round(rx*Math.sqrt(Math.max(0,1-(row/ry)**2)));
    ctx.fillRect(Math.round(x-half),Math.round(y+row),half*2+1,1);
  }
}
function line(ctx,points,color,width=1) {
  ctx.fillStyle=color;const size=Math.max(1,Math.round(width));
  for(let i=1;i<points.length;i++) {
    const [ax,ay]=points[i-1],[bx,by]=points[i],steps=Math.max(1,Math.ceil(Math.max(Math.abs(bx-ax),Math.abs(by-ay))));
    for(let n=0;n<=steps;n++)ctx.fillRect(Math.round(ax+(bx-ax)*n/steps),Math.round(ay+(by-ay)*n/steps),size,size);
  }
}
function heart(ctx,x,y,size,color='#f4a5bd') {
  ctx.fillStyle=color;const unit=Math.max(1,Math.round(size/3));
  for(const [row,pattern] of ['0110110','1111111','1111111','0111110','0011100','0001000'].entries())
    for(let col=0;col<7;col++)if(pattern[col]==='1')ctx.fillRect(Math.round(x)+(col-3)*unit,Math.round(y)+row*unit,unit,unit);
}
const exposure = (rabbit, channel) => Math.max(0, Number(rabbit.exposure?.[channel]) || 0);

export { drawPixelRabbit as drawRabbit } from './RabbitPixelArt.mjs';

function roundedRect(ctx,x,y,width,height,radius) {
  // Four stepped corners on the same pixel grid as the animals and fences.
  ctx.beginPath();ctx.rect(x+3,y,width-6,height);ctx.rect(x,y+3,width,height-6);
}

/** Shared pen and one isolation cage. Positions animate only the drawing;
 * breeding, aging and attacks remain controlled by the experiment simulation. */
export class RabbitColonyRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.targets = [];
    this.poses = new Map(); this.motionOffset=0; this.pausedAt=0;
    this.lastPaint = -Infinity; this.lastClock = 0; this.frozenClock = 0; this.paused = false;
  }

  render(experiments, selectedId, time = 0, cullMode = false, paused = false) {
    if (!this.ctx) return;
    const rabbits = (experiments?.rabbits || []).filter(rabbit=>!rabbit.remainsRecovered);
    if (paused && !this.paused) {this.frozenClock = this.lastClock || time;this.pausedAt=Date.now();}
    if (!paused && this.paused) this.motionOffset+=Date.now()-this.pausedAt;
    const clock = paused ? this.frozenClock : time;
    this.paused = paused; this.lastClock = clock;
    const signature = `${rabbitArtworkVersion()}:${selectedId}:${cullMode}:${paused}:${rabbits.map(rabbit => `${rabbit.id}:${rabbit.location}:${rabbit.age}:${rabbit.stats?.health}:${rabbit.stats?.doseCount}:${rabbit.stats?.alive}:${rabbit.dangerous}:${Object.values(rabbit.exposure || {}).join(',')}`).join('|')}`;
    if (signature === this.signature && (paused || time - this.lastPaint < 32)) return;
    this.signature = signature; this.lastPaint = time; this.targets = [];
    const ctx = this.ctx; ctx.save(); ctx.setTransform(this.canvas.width / 640, 0, 0, this.canvas.height / 350, 0, 0);
    ctx.clearRect(0, 0, 640, 350); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled=false;
    ctx.fillStyle='#324358';ctx.fillRect(0,0,640,350);
    for (let row = 0; row < 5; row++) for (let column = 0; column < 10; column++) {
      const bx = column * 76 + (row % 2 ? -38 : 0), by = row * 36;
      ctx.fillStyle = row % 2 ? '#41536a' : '#3c4d63'; ctx.fillRect(bx + 2, by + 2, 72, 32);
      ctx.fillStyle='#53677c';ctx.fillRect(bx+4,by+4,65,2);
    }
    for(const lx of [65,568]) {
      ctx.fillStyle='#283348';ctx.fillRect(lx-10,60,20,21);ctx.fillStyle='#f5cf81';ctx.fillRect(lx-6,64,12,13);
      ctx.fillStyle='#fff0b1';ctx.fillRect(lx-3,67,6,7);ctx.fillStyle='#987955';ctx.fillRect(lx-11,80,22,4);
    }
    ctx.fillStyle = '#283b3c'; roundedRect(ctx, 18, 81, 398, 225, 15); ctx.fill();
    ctx.fillStyle = '#739760'; roundedRect(ctx, 24, 87, 386, 212, 12); ctx.fill();
    for (let index = 0; index < 75; index++) {
      const gx = 31 + randomAt(831, index) * 370, gy = 97 + randomAt(155, index) * 188;
      line(ctx, [[gx - 2, gy + 1], [gx, gy - 2], [gx + 3, gy]], index % 3 ? '#94b775' : '#b1c980', .75);
    }
    // Straw and feeding details give the enclosure a legible physical scale.
    oval(ctx, 67, 121, 25, 7, '#3c493a'); oval(ctx, 65, 118, 20, 5, '#a69b69');
    for (let index = 0; index < 12; index++) line(ctx, [[49 + index * 2.5, 116 + index % 3], [58 + index * 2, 121]], '#d1b680', .7);
    oval(ctx, 382, 116, 16, 7, '#9b8a74'); oval(ctx, 382, 114, 13, 4, '#7ba5ad');
    this.fence(ctx, false);

    ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#dfcaa7'; ctx.fillText('Rabbit colony', 24, 33);
    ctx.font = '10px monospace'; ctx.fillStyle = '#aeb2a1';
    const living = rabbits.filter(rabbit => rabbit.stats?.alive !== false);
    ctx.fillText(`${living.length} living · ${living.filter(rabbit => rabbit.age === 'baby').length} babies`, 24, 49);
    ctx.fillStyle = '#dfcaa7'; ctx.font = 'bold 13px monospace'; ctx.fillText('Isolation cage', 444, 33);
    ctx.font = '10px monospace'; ctx.fillStyle = '#aeb2a1'; ctx.fillText(cullMode ? 'Cull tool equipped' : 'Select a rabbit to inspect', 444, 49);

    const worldClock=(paused?this.pausedAt:Date.now())-this.motionOffset;
    const visibleIds=new Set(rabbits.map(rabbit=>rabbit.id));
    for(const id of this.poses.keys())if(!visibleIds.has(id))this.poses.delete(id);
    const allPoses=rabbitColonyPoses(rabbits,worldClock).map(pose=>{
      const previous=this.poses.get(pose.rabbit.id);
      const fixed=!pose.rabbit.stats.alive&&previous?{...pose,x:previous.x,y:previous.y,facing:previous.facing,hop:0,gait:0,activity:'still'}:pose;
      this.poses.set(pose.rabbit.id,fixed);return fixed;
    });
    const positioned=allPoses.filter(pose=>pose.rabbit.location!=='cage').sort((a,b)=>a.y-b.y);
    // Courtship relates two actual adult rabbits; no imaginary companion appears.
    const affectionate = positioned.filter(item => item.rabbit.stats?.alive !== false && item.rabbit.age !== 'baby' && exposure(item.rabbit, 'love') > .05 && !item.rabbit.aggression && !item.rabbit.dangerous && exposure(item.rabbit, 'love') < 2.5);
    for (const admirer of affectionate) {
      const partner = positioned.find(item => item.rabbit.stats?.alive !== false && item.rabbit.age !== 'baby' && item.rabbit.id !== admirer.rabbit.id && item.rabbit.sex !== admirer.rabbit.sex && !item.rabbit.dangerous && !item.rabbit.aggression);
      if (partner) {
        ctx.setLineDash([2, 5]); line(ctx, [[admirer.x, admirer.y - 31], [partner.x, partner.y - 31]], 'rgba(206,145,163,.27)', .8); ctx.setLineDash([]);
        heart(ctx, lerp(admirer.x, partner.x, .5), lerp(admirer.y, partner.y, .5) - 34 - Math.sin(clock * .003) * 3, 3.3, '#d6a1af');
      }
    }
    for (const item of positioned) this.specimen(ctx,item.rabbit,item.x,item.y,48,clock,selectedId,cullMode,item);
    this.fence(ctx, true);
    this.cage(ctx);
    const isolated = allPoses.find(pose => pose.rabbit.location === 'cage');
    if (isolated) this.specimen(ctx,isolated.rabbit,isolated.x,isolated.y,96,clock,selectedId,cullMode,isolated,true);
    else {
      ctx.textAlign = 'center'; ctx.font = '11px monospace'; ctx.fillStyle = '#9d9b90'; ctx.fillText('An empty observation cage', 529, 213);
    }
    // Front cage bars frame the specimen without hiding the inspected anatomy.
    line(ctx, [[438, 298], [620, 298]], '#9f9683', 2.2); line(ctx, [[438, 304], [620, 304]], '#514c46', 4);
    ctx.fillStyle = '#aaa995'; ctx.textAlign = 'left'; ctx.font = '10px monospace';
    ctx.fillText(cullMode ? 'Click a rabbit to cull it immediately' : 'Click a rabbit in the pen or cage to select it', 24, 330);
    ctx.restore();
  }

  specimen(ctx, rabbit, x, y, size, time, selectedId, cullMode, pose, isolated = false) {
    const selected = rabbit.id === selectedId, alive = rabbit.stats?.alive !== false;
    drawRabbit(ctx,rabbit,x,y,size,time,{facing:pose.facing,activity:pose.activity,gait:pose.gait,hop:pose.hop,selected,cullMode});
    const baby = rabbit.age === 'baby', labelY = y + 15;
    const name = String(rabbit.name || 'Moon rabbit');
    const label = `${name.length > 12 ? `${name.slice(0, 11)}…` : name} ${rabbit.sex === 'male' ? '♂' : rabbit.sex === 'female' ? '♀' : ''}`;
    ctx.font = `${selected ? '600 ' : ''}${isolated ? 11 : 9}px monospace`;
    const labelWidth = Math.min(isolated ? 164 : 87, ctx.measureText(label).width + 10);
    ctx.fillStyle = selected ? '#494535' : '#333c35'; roundedRect(ctx, x - labelWidth / 2, labelY - 9, labelWidth, 14, 4); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = selected ? '#ead5a9' : alive ? '#d7d1ba' : '#a9a299'; ctx.fillText(label, x, labelY + 1);
    if (baby || !alive || rabbit.dangerous || rabbit.aggression) {
      ctx.font = '8px monospace'; ctx.fillStyle = !alive ? '#baaaa1' : rabbit.dangerous || rabbit.aggression ? '#e29b88' : '#b8c7a7';
      ctx.fillText(!alive ? rabbit.deathAppearance === 'dissolved' || exposure(rabbit, 'acidity') >= 2.5 ? 'dissolved' : 'deceased' : rabbit.dangerous || rabbit.aggression ? 'dangerous' : 'baby · fragile', x, labelY + 13);
    }
    const drawSize = size * (baby ? .7 : 1);
    this.targets.push({ id: rabbit.id, x, y: y - drawSize * .46, width: Math.max(34, drawSize * 1.2), height: Math.max(40, drawSize * 1.13), floor: y });
  }

  fence(ctx, foreground) {
    if (!foreground) {
      line(ctx, [[23, 105], [413, 105]], '#a28c69', 4); line(ctx, [[23, 122], [413, 122]], '#75674f', 3);
      for (const x of [23, 119, 216, 313, 413]) {
        ctx.fillStyle = '#807053'; ctx.fillRect(x - 3, 88, 7, 55); ctx.fillStyle = '#b29a72'; ctx.fillRect(x - 2, 88, 2, 55);
      }
      line(ctx, [[22, 111], [22, 284]], '#817251', 3); line(ctx, [[414, 112], [414, 285]], '#817251', 3);
      return;
    }
    for (const x of [23, 119, 216, 313, 413]) {
      ctx.fillStyle = '#6b604c'; ctx.fillRect(x - 4, 276, 9, 38); ctx.fillStyle = '#a38d6a'; ctx.fillRect(x - 3, 276, 3, 37);
      ctx.fillStyle = '#c3ad81'; ctx.fillRect(x - 4, 275, 9, 3);
    }
    line(ctx, [[22, 283], [413, 283]], '#a08d6a', 4); line(ctx, [[22, 300], [413, 300]], '#827253', 4);
    line(ctx, [[22, 282], [413, 282]], '#c1ac7f', 1);
    for (const x of [67, 160, 266, 357]) {
      line(ctx, [[x, 283], [x + 34, 300]], '#79694e', 2); line(ctx, [[x, 300], [x + 34, 283]], '#79694e', 2);
    }
  }

  cage(ctx) {
    ctx.fillStyle = '#333b3b'; roundedRect(ctx, 436, 130, 188, 176, 9); ctx.fill();
    ctx.fillStyle='#a5af79';ctx.fillRect(440,233,180,66);ctx.fillStyle='#8c9a69';ctx.fillRect(440,282,180,17);
    for (let index = 0; index < 14; index++) line(ctx, [[445 + index * 13, 239], [441 + index * 13, 298]], '#64674f', .7);
    ctx.fillStyle = '#454a47'; ctx.fillRect(444, 139, 172, 8);
    line(ctx, [[438, 137], [438, 302], [622, 302], [622, 137]], '#a39b86', 3);
    for (const x of [443, 470, 497, 524, 551, 578, 616]) {
      line(ctx, [[x, 149], [x, 234]], '#566061', 2); line(ctx, [[x + 1, 149], [x + 1, 234]], '#818984', .7);
    }
    line(ctx, [[438, 146], [622, 146]], '#b0a78e', 2.4); line(ctx, [[438, 134], [622, 134]], '#8b8b7c', 4);
    line(ctx, [[437, 134], [458, 115], [605, 115], [622, 134]], '#8f9389', 2);
    for (const x of [469, 497, 525, 553, 581]) line(ctx, [[x, 115], [x - 11, 133]], '#6c7471', 1);
    ctx.fillStyle = '#b69c6e'; ctx.fillRect(435, 189, 8, 13); ctx.fillStyle = '#3c4141'; ctx.fillRect(437, 194, 3, 6);
  }

  hitTest(clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const x = (clientX - bounds.left) / bounds.width * 640, y = (clientY - bounds.top) / bounds.height * 350;
    // Keep small and crowded specimens tappable at phone canvas widths, then
    // resolve overlaps by proximity instead of whichever rabbit was drawn last.
    const minimumWidth = 28 * 640 / bounds.width, minimumHeight = 28 * 350 / bounds.height;
    let nearest = null, nearestDistance = Infinity;
    for (let index = this.targets.length - 1; index >= 0; index--) {
      const target = this.targets[index];
      if (Math.abs(x - target.x) > Math.max(target.width, minimumWidth) / 2 || Math.abs(y - target.y) > Math.max(target.height, minimumHeight) / 2) continue;
      const distance = ((x - target.x) * bounds.width / 640) ** 2 + ((y - target.y) * bounds.height / 350) ** 2;
      if (distance < nearestDistance) { nearest = target.id; nearestDistance = distance; }
    }
    return nearest;
  }
}
