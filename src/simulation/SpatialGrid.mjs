export class SpatialGrid {
  constructor(capacity, maxExtent=32, cellSize=0.58) {
    this.capacity=capacity; this.cellSize=cellSize; this.maxExtent=maxExtent;
    this.maxAxis=Math.ceil(maxExtent/cellSize)+3; this.head=new Int32Array(1);this.head[0]=-1; this.next=new Int32Array(capacity);
    this.nx=this.ny=this.nz=1; this.minX=this.minY=this.minZ=0; this.cellCount=1; this.dimensionMode='3D';
    this.stencils=new Map();this.stencilNX=this.stencilNY=this.stencilNZ=0;
  }
  setDimensionMode(mode){this.dimensionMode=mode==='2D'?'2D':'3D';}
  configure(box){
    this.nx=Math.min(this.maxAxis,Math.ceil(box.width/this.cellSize)+1); this.ny=Math.min(this.maxAxis,Math.ceil(box.height/this.cellSize)+1); this.nz=this.dimensionMode==='2D'?1:Math.min(this.maxAxis,Math.ceil(box.depth/this.cellSize)+1);
    this.minX=-box.width/2; this.minY=-box.height/2; this.minZ=this.dimensionMode==='2D'?0:-box.depth/2; this.cellCount=this.nx*this.ny*this.nz;
    if(this.nx!==this.stencilNX||this.ny!==this.stencilNY||this.nz!==this.stencilNZ){this.stencils.clear();this.stencilNX=this.nx;this.stencilNY=this.ny;this.stencilNZ=this.nz;}
    if(this.head.length<this.cellCount){this.head=new Int32Array(this.cellCount);this.head.fill(-1);}
  }
  forwardStencil(reach){
    let stencil=this.stencils.get(reach);
    if(stencil)return stencil;
    const offsets=[],rx=Math.min(reach,this.nx-1),ry=Math.min(reach,this.ny-1),rz=this.dimensionMode==='2D'?0:Math.min(reach,this.nz-1);
    // Preserve the old cell/pair order: chemistry and granular projection are
    // order-sensitive, and pair-stride phases must visit the same contacts.
    for(let dz=0;dz<=rz;dz++)for(let dy=-ry;dy<=ry;dy++)for(let dx=-rx;dx<=rx;dx++){
      if(dz===0&&(dy<0||(dy===0&&dx<=0)))continue;
      offsets.push(dx,dy,dz,dx+this.nx*(dy+this.ny*dz));
    }
    stencil=new Int32Array(offsets);this.stencils.set(reach,stencil);return stencil;
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
    const reach=Math.max(1,Math.ceil(radius/this.cellSize)),zReach=this.dimensionMode==='2D'?0:reach,head=this.head,next=this.next,r2=radius*radius,x=ps.x,y=ps.y,z=ps.z;
    for(let dz=-zReach;dz<=zReach;dz++){
      const zz=cz+dz;if(zz<0||zz>=this.nz)continue;
      for(let dy=-reach;dy<=reach;dy++){
        const yy=cy+dy;if(yy<0||yy>=ny)continue;
        for(let dx=-reach;dx<=reach;dx++){
          const xx=cx+dx;if(xx<0||xx>=nx)continue;
          let j=head[xx+nx*(yy+ny*zz)];while(j!==-1){if(j!==index){const dx=x[j]-x[index],dy=y[j]-y[index],dz=z[j]-z[index];if(dx*dx+dy*dy+dz*dz<=r2)callback(j);}j=next[j];}
        }
      }
    }
  }
  forEachPair(ps,radius,callback,stride=1,phase=0,forcePair=null){
    const nx=this.nx,ny=this.ny,nz=this.nz,head=this.head,next=this.next;
    const reach=Math.max(1,Math.ceil(radius/this.cellSize)),stencil=this.forwardStencil(reach),s=Math.max(1,stride|0),p=((phase%s)+s)%s;let ordinal=0;
    // A swept granular collision cannot be deferred to the next stride: by
    // then previous positions are gone and the two grains may have crossed.
    const r2=radius*radius,x=ps.x,y=ps.y,z=ps.z;
    const emit=(i,j)=>{const dx=x[j]-x[i],dy=y[j]-y[i],dz=z[j]-z[i],d2=dx*dx+dy*dy+dz*dz;if(d2>r2)return;const take=s===1||(ordinal%s)===p||forcePair?.(i,j);ordinal++;if(take)callback(i,j,dx,dy,dz,d2);};
    for(let cz=0;cz<nz;cz++)for(let cy=0;cy<ny;cy++)for(let cx=0;cx<nx;cx++){
      const c=cx+nx*(cy+ny*cz),first=head[c];if(first===-1)continue;
      for(let i=first;i!==-1;i=next[i])for(let j=next[i];j!==-1;j=next[j])emit(i,j);
      for(let n=0;n<stencil.length;n+=4){
        const xx=cx+stencil[n],yy=cy+stencil[n+1],zz=cz+stencil[n+2];if(xx<0||yy<0||xx>=nx||yy>=ny||zz>=nz)continue;
        const second=head[c+stencil[n+3]];if(second===-1)continue;
        for(let i=first;i!==-1;i=next[i])for(let j=second;j!==-1;j=next[j])emit(i,j);
      }
    }
  }
  neighborsArray(ps,index,radius,out=[]){out.length=0;this.forEachNeighbor(ps,index,radius,j=>out.push(j));return out;}
}
