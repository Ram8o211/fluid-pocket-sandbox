import { clamp } from './math.mjs';

const SIZE={S:{w:1.5,h:1.15},M:{w:2.35,h:1.7},L:{w:3.5,h:2.35},XL:{w:4.8,h:3.05}};

export class MoldSystem{
  constructor(){this.molds=[];this.nextId=1;}
  clear(){this.molds.length=0;this.nextId=1;}
  add(point,size='M',box={width:5,height:7}){
    const d=SIZE[size]||SIZE.M,t=.14,w=Math.min(d.w,box.width*.82),h=Math.min(d.h,box.height*.6),margin=.18;
    const x=clamp(point.x,-box.width/2+w/2+margin,box.width/2-w/2-margin),y=clamp(point.y,-box.height/2+h/2+margin,box.height/2-h/2-margin);
    const mold={id:this.nextId++,type:'U',x,y,width:w,height:h,thickness:t};this.molds.push(mold);return mold;
  }
  restore(list=[]){this.molds=(list||[]).filter(Boolean).map(m=>({...m,id:Number(m.id)||this.nextId++}));this.nextId=this.molds.reduce((v,m)=>Math.max(v,m.id+1),1);}
  walls(m){const t=m.thickness,w=m.width,h=m.height;return[
    {x:m.x-w/2,y:m.y,width:t,height:h},
    {x:m.x+w/2,y:m.y,width:t,height:h},
    {x:m.x,y:m.y-h/2,width:w+t,height:t}
  ];}
  collide(ps,planar=false){
    if(!this.molds.length)return;const radius=.105;
    for(let i=0;i<ps.count;i++)for(const m of this.molds)for(const wall of this.walls(m)){
      const dx=ps.x[i]-wall.x,dy=ps.y[i]-wall.y,hx=wall.width/2+radius,hy=wall.height/2+radius;
      if(Math.abs(dx)>=hx||Math.abs(dy)>=hy)continue;
      const penX=hx-Math.abs(dx),penY=hy-Math.abs(dy);
      if(penX<penY){const s=dx===0?1:Math.sign(dx);ps.x[i]+=s*penX;if(ps.vx[i]*s<0)ps.vx[i]*=-.04;ps.vy[i]*=.72;if(!planar)ps.vz[i]*=.78;}
      else{const s=dy===0?1:Math.sign(dy);ps.y[i]+=s*penY;if(ps.vy[i]*s<0)ps.vy[i]*=-.04;ps.vx[i]*=.66;if(!planar)ps.vz[i]*=.78;}
    }
  }
}
