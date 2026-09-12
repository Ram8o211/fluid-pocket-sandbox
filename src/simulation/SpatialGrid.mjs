export class SpatialGrid {
  constructor(capacity, maxExtent=12, cellSize=0.58) {
    this.capacity=capacity; this.cellSize=cellSize; this.maxExtent=maxExtent;
    this.maxAxis=Math.ceil(maxExtent/cellSize)+3; this.head=new Int32Array(this.maxAxis**3); this.next=new Int32Array(capacity);
    this.nx=this.ny=this.nz=1; this.minX=this.minY=this.minZ=0; this.cellCount=1;
  }
  configure(box){
    this.nx=Math.min(this.maxAxis,Math.ceil(box.width/this.cellSize)+1); this.ny=Math.min(this.maxAxis,Math.ceil(box.height/this.cellSize)+1); this.nz=Math.min(this.maxAxis,Math.ceil(box.depth/this.cellSize)+1);
    this.minX=-box.width/2; this.minY=-box.height/2; this.minZ=-box.depth/2; this.cellCount=this.nx*this.ny*this.nz;
  }
  indexFromPosition(x,y,z){
    const ix=Math.max(0,Math.min(this.nx-1,Math.floor((x-this.minX)/this.cellSize)));
    const iy=Math.max(0,Math.min(this.ny-1,Math.floor((y-this.minY)/this.cellSize)));
    const iz=Math.max(0,Math.min(this.nz-1,Math.floor((z-this.minZ)/this.cellSize)));
    return ix + this.nx*(iy+this.ny*iz);
  }
  coordsFromIndex(c){ const iz=Math.floor(c/(this.nx*this.ny)); const rem=c-iz*this.nx*this.ny; const iy=Math.floor(rem/this.nx); return [rem-iy*this.nx,iy,iz]; }
  rebuild(ps,box){ this.configure(box); this.head.fill(-1,0,this.cellCount); for(let i=0;i<ps.count;i++){ const c=this.indexFromPosition(ps.x[i],ps.y[i],ps.z[i]); this.next[i]=this.head[c]; this.head[c]=i; ps.cell[i]=c; } }
  forEachNeighbor(ps,index,radius,callback){
    const [cx,cy,cz]=this.coordsFromIndex(ps.cell[index]); const reach=Math.max(1,Math.ceil(radius/this.cellSize));
    for(let dz=-reach;dz<=reach;dz++)for(let dy=-reach;dy<=reach;dy++)for(let dx=-reach;dx<=reach;dx++){
      const x=cx+dx,y=cy+dy,z=cz+dz; if(x<0||y<0||z<0||x>=this.nx||y>=this.ny||z>=this.nz)continue;
      let j=this.head[x+this.nx*(y+this.ny*z)]; while(j!==-1){ if(j!==index)callback(j); j=this.next[j]; }
    }
  }
  neighborsArray(ps,index,radius,out=[]){ out.length=0; this.forEachNeighbor(ps,index,radius,j=>out.push(j)); return out; }
}
