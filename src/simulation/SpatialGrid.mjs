export class SpatialGrid {
  constructor(capacity, maxExtent=32, cellSize=0.58) {
    this.capacity=capacity; this.cellSize=cellSize; this.maxExtent=maxExtent;
    this.maxAxis=Math.ceil(maxExtent/cellSize)+3; this.head=new Int32Array(this.maxAxis**3); this.next=new Int32Array(capacity);
    this.nx=this.ny=this.nz=1; this.minX=this.minY=this.minZ=0; this.cellCount=1; this.dimensionMode='3D';
  }
  setDimensionMode(mode){this.dimensionMode=mode==='2D'?'2D':'3D';}
  configure(box){
    this.nx=Math.min(this.maxAxis,Math.ceil(box.width/this.cellSize)+1); this.ny=Math.min(this.maxAxis,Math.ceil(box.height/this.cellSize)+1); this.nz=this.dimensionMode==='2D'?1:Math.min(this.maxAxis,Math.ceil(box.depth/this.cellSize)+1);
    this.minX=-box.width/2; this.minY=-box.height/2; this.minZ=this.dimensionMode==='2D'?0:-box.depth/2; this.cellCount=this.nx*this.ny*this.nz;
  }
  indexFromPosition(x,y,z){
    const ix=Math.max(0,Math.min(this.nx-1,Math.floor((x-this.minX)/this.cellSize)));
    const iy=Math.max(0,Math.min(this.ny-1,Math.floor((y-this.minY)/this.cellSize)));
    const iz=this.dimensionMode==='2D'?0:Math.max(0,Math.min(this.nz-1,Math.floor((z-this.minZ)/this.cellSize)));
    return ix + this.nx*(iy+this.ny*iz);
  }
  coordsFromIndex(c){const nxy=this.nx*this.ny,iz=Math.floor(c/nxy),rem=c-iz*nxy,iy=Math.floor(rem/this.nx);return [rem-iy*this.nx,iy,iz];}
  rebuild(ps,box){
    this.configure(box);this.head.fill(-1,0,this.cellCount);
    const head=this.head,next=this.next,x=ps.x,y=ps.y,z=ps.z,cell=ps.cell;
    for(let i=0;i<ps.count;i++){const c=this.indexFromPosition(x[i],y[i],z[i]);next[i]=head[c];head[c]=i;cell[i]=c;}
  }
  forEachNeighbor(ps,index,radius,callback){
    const nx=this.nx,ny=this.ny,nxy=nx*ny,c=ps.cell[index],cz=Math.floor(c/nxy),rem=c-cz*nxy,cy=Math.floor(rem/nx),cx=rem-cy*nx;
    const reach=Math.max(1,Math.ceil(radius/this.cellSize)),zReach=this.dimensionMode==='2D'?0:reach,head=this.head,next=this.next;
    for(let dz=-zReach;dz<=zReach;dz++){
      const zz=cz+dz;if(zz<0||zz>=this.nz)continue;
      for(let dy=-reach;dy<=reach;dy++){
        const yy=cy+dy;if(yy<0||yy>=ny)continue;
        for(let dx=-reach;dx<=reach;dx++){
          const xx=cx+dx;if(xx<0||xx>=nx)continue;
          let j=head[xx+nx*(yy+ny*zz)];while(j!==-1){if(j!==index)callback(j);j=next[j];}
        }
      }
    }
  }
  forEachPair(ps,radius,callback,stride=1,phase=0){
    const nx=this.nx,ny=this.ny,nz=this.nz,head=this.head,next=this.next;
    const reach=Math.max(1,Math.ceil(radius/this.cellSize)),zReach=this.dimensionMode==='2D'?0:reach,s=Math.max(1,stride|0),p=((phase%s)+s)%s;let ordinal=0;
    const emit=(i,j)=>{const take=s===1||(ordinal%s)===p;ordinal++;if(take)callback(i,j);};
    for(let cz=0;cz<nz;cz++)for(let cy=0;cy<ny;cy++)for(let cx=0;cx<nx;cx++){
      const c=cx+nx*(cy+ny*cz),first=head[c];if(first===-1)continue;
      for(let i=first;i!==-1;i=next[i])for(let j=next[i];j!==-1;j=next[j])emit(i,j);
      for(let dz=-zReach;dz<=zReach;dz++)for(let dy=-reach;dy<=reach;dy++)for(let dx=-reach;dx<=reach;dx++){
        if(dz<0||(dz===0&&dy<0)||(dz===0&&dy===0&&dx<=0))continue;
        const xx=cx+dx,yy=cy+dy,zz=cz+dz;if(xx<0||yy<0||zz<0||xx>=nx||yy>=ny||zz>=nz)continue;
        const second=head[xx+nx*(yy+ny*zz)];if(second===-1)continue;
        for(let i=first;i!==-1;i=next[i])for(let j=second;j!==-1;j=next[j])emit(i,j);
      }
    }
  }
  neighborsArray(ps,index,radius,out=[]){out.length=0;this.forEachNeighbor(ps,index,radius,j=>out.push(j));return out;}
}
