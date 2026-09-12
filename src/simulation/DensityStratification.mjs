import { normalize3 } from './math.mjs';
export function stratificationImpulse(densityA,densityB,gravity,magnitude=1){ const [gx,gy,gz]=normalize3(gravity.x,gravity.y,gravity.z); const sign=densityA>densityB?1:-1; const d=Math.min(1,Math.abs(densityA-densityB)); return {x:gx*d*magnitude*sign,y:gy*d*magnitude*sign,z:gz*d*magnitude*sign}; }
