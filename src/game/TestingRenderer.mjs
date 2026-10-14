import { experimentSubjectSprite } from './art.mjs';

/** One fixed-size animated enclosure. All channels remain visible together;
 * no effect names, numerical readouts or observation text are painted here. */
export class TestingRenderer {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.sprites = new Map(); }
  sprite(id) {
    if (!this.sprites.has(id)) { const image = new Image(); image.src = experimentSubjectSprite(id,'healthy'); this.sprites.set(id,image); }
    return this.sprites.get(id);
  }
  render(subject, report, time, before = false) {
    if (!this.ctx || !subject) return;
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    const stats = before && report ? report.before : subject.stats;
    const effects = !before && report ? report.effects : {};
    const response = value => Math.min(1,Math.sqrt(Math.max(0,value || 0)));
    const fire = response(effects.fire), frost = response(effects.freeze), venom = response(effects.poison), blight = response(effects.acidity), death = response(effects.death);
    const strength = Math.min(1,Math.max(0,stats.strength-(subject.id==='beetle'?35:20))/65), love = stats.love/100, change = stats.transformation/100;
    ctx.clearRect(0,0,w,h); ctx.fillStyle='#262432'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#474053'; for(let x=0;x<w;x+=32) { ctx.fillRect(x,0,2,h-35); ctx.fillRect(x,50,30,2); }
    ctx.fillStyle='#576149';ctx.fillRect(0,h-36,w,36);ctx.fillStyle='#798462';ctx.fillRect(0,h-36,w,3);
    // The untreated companion and lifting crate provide spatial references.
    ctx.fillStyle='#b9916a';ctx.fillRect(22,h-65-strength*38,30,29);ctx.fillStyle='#674731';ctx.fillRect(27,h-63-strength*38,3,25);
    ctx.fillStyle='#a9bab3';ctx.beginPath();ctx.ellipse(w-46,h-52,14,10,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#373844';ctx.fillRect(w-51,h-56,3,3);ctx.fillRect(w-42,h-56,3,3);
    const alive=stats.alive, speed=(1-frost*.8)*(1-venom*.5);
    const walk=Math.sin(time*.0016*speed), x=w*.45+love*45+walk*(alive?10:0);
    const y=h-77-(alive?Math.abs(Math.sin(time*.003*speed))*7:0)+death*10;
    const size=88+change*24;
    ctx.save();ctx.translate(x,y);ctx.rotate(alive?Math.sin(time*.008)*venom*.12:Math.PI*.5);
    ctx.globalAlpha=alive?Math.max(.25,1-death*.65):.3;
    const sprite=this.sprite(subject.id);if(sprite.complete&&sprite.naturalWidth)ctx.drawImage(sprite,-size/2,-size/2,size,size);
    if(change>.005){ctx.globalCompositeOperation='source-atop';ctx.globalAlpha=Math.min(.5,change);ctx.fillStyle='#af73e4';ctx.fillRect(-size/2,-size/2,size,size);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.fillStyle='#6be7ce';ctx.fillRect(-10,-size/2-7-change*15,5,12+change*15);ctx.fillRect(10,-size/2-7-change*15,5,12+change*15);}
    if(subject.id==='stone'||subject.id==='seedling'){ctx.globalAlpha=1;ctx.fillStyle='#fff0bf';ctx.fillRect(-9,-2,5,6);ctx.fillRect(4,-2,5,6);ctx.fillStyle='#302b3d';ctx.fillRect(-7,0,2,3);ctx.fillRect(6,0,2,3);}
    ctx.restore();
    // The neighboring flower visibly loses leaves under withering magic.
    ctx.strokeStyle='#8cc483';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(w-90,h-36);ctx.lineTo(w-90+blight*12,h-72+blight*22);ctx.stroke();
    ctx.fillStyle='#db9fc5';ctx.beginPath();ctx.arc(w-90+blight*12,h-74+blight*22,6*(1-blight*.6),0,Math.PI*2);ctx.fill();
    for(let i=0;i<12;i++) {
      const angle=i*2.39996+time*.001, radius=32+(i%3)*6;
      if(fire>.015){ctx.globalAlpha=fire*.8;ctx.fillStyle=i%2?'#ffcf6d':'#ee6d38';const rise=(time*.045+i*9)%54;ctx.fillRect(x-30+(i*17)%60,y+30-rise,3+(i%2),8+fire*12);}
      if(frost>.015){ctx.globalAlpha=frost*.9;ctx.strokeStyle='#9aeaff';ctx.lineWidth=1.5;const fx=x+Math.cos(angle*.3)*radius,fy=y+Math.sin(angle*.3)*radius;ctx.beginPath();ctx.moveTo(fx-4,fy);ctx.lineTo(fx+4,fy);ctx.moveTo(fx,fy-4);ctx.lineTo(fx,fy+4);ctx.stroke();}
      if(venom>.015&&i<6){ctx.globalAlpha=venom*.75;ctx.fillStyle='#9bbf56';ctx.beginPath();ctx.arc(x+Math.sin(angle)*29,y+17-((time*.014+i*9)%46),3+venom*4,0,Math.PI*2);ctx.fill();}
      if(death>.015&&i<5){ctx.globalAlpha=death*.7;ctx.fillStyle='#9981c2';ctx.beginPath();ctx.ellipse(x+Math.cos(angle)*radius,y-((time*.02+i*8)%45),5,9,0,0,Math.PI*2);ctx.fill();}
      if(love>.004&&i<5){ctx.globalAlpha=Math.min(1,.3+love*2);ctx.fillStyle='#ef84b6';const hx=x+35+i*8,hy=y+10-((time*.025+i*11)%45);ctx.fillRect(hx,hy,4,4);ctx.fillRect(hx+5,hy,4,4);ctx.fillRect(hx+2,hy+3,5,5);}
    }
    ctx.globalAlpha=1;
  }
}
