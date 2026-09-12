import { clamp } from '../simulation/math.mjs';
export class ManualGravityProvider {
  constructor(){this.kind='manual';this.enabled=true;this.sensitivity=1;this.x=0;this.y=-1;this.z=0;}
  setTilt(x,z){this.x=clamp(x,-1,1)*this.sensitivity;this.z=clamp(z,-1,1)*this.sensitivity;this.y=-Math.sqrt(Math.max(.04,1-Math.min(.96,this.x*this.x+this.z*this.z)));}
  getGravity(){return {x:this.x,y:this.y,z:this.z};}
  calibrate(){}
  reset(){this.x=0;this.y=-1;this.z=0;}
}
export class TestGravityProvider extends ManualGravityProvider { constructor(v={x:0,y:-1,z:0}){super();this.kind='test';this.x=v.x;this.y=v.y;this.z=v.z;} }
export class DeviceOrientationProvider {
  constructor(){this.kind='device';this.enabled=false;this.supported='DeviceOrientationEvent' in globalThis;this.sensitivity=1;this.smoothing=.14;this.offsetBeta=0;this.offsetGamma=0;this.beta=0;this.gamma=0;this.fx=0;this.fz=0;this.pendingCalibration=false;this.handler=(e)=>this.onOrientation(e);}
  async enable(){
    if(!this.supported)return false;const DOE=/** @type {any} */ (globalThis.DeviceOrientationEvent);
    if(typeof DOE?.requestPermission==='function'){const p=await DOE.requestPermission();if(p!=='granted')return false;}
    if(this.enabled)return true;this.pendingCalibration=true;this.fx=0;this.fz=0;globalThis.addEventListener('deviceorientation',this.handler,{passive:true});this.enabled=true;return true;
  }
  disable(){if(this.enabled)globalThis.removeEventListener('deviceorientation',this.handler);this.enabled=false;this.pendingCalibration=false;this.fx=0;this.fz=0;}
  calibrate(){this.offsetBeta=this.beta;this.offsetGamma=this.gamma;this.fx=0;this.fz=0;this.pendingCalibration=false;}
  reset(){this.offsetBeta=0;this.offsetGamma=0;this.fx=0;this.fz=0;this.pendingCalibration=this.enabled;}
  onOrientation(e){
    const beta=Number.isFinite(e.beta)?e.beta:0,gamma=Number.isFinite(e.gamma)?e.gamma:0;this.beta=clamp(beta,-90,90);this.gamma=clamp(gamma,-90,90);
    if(this.pendingCalibration){this.offsetBeta=this.beta;this.offsetGamma=this.gamma;this.pendingCalibration=false;this.fx=0;this.fz=0;return;}
    const deadzone=v=>Math.abs(v)<.025?0:v,xRaw=clamp((this.gamma-this.offsetGamma)/45,-1,1)*this.sensitivity,zRaw=clamp((this.beta-this.offsetBeta)/55,-1,1)*this.sensitivity,x=deadzone(xRaw),z=deadzone(zRaw);this.fx+=(x-this.fx)*this.smoothing;this.fz+=(z-this.fz)*this.smoothing;
  }
  getGravity(){const x=clamp(this.fx,-.95,.95),z=clamp(this.fz,-.95,.95),y=-Math.sqrt(Math.max(.04,1-Math.min(.96,x*x+z*z)));return {x,y,z};}
}
export class GravityController {
  constructor(){this.manual=new ManualGravityProvider();this.device=new DeviceOrientationProvider();this.active=this.manual;}
  async enableDevice(){if(await this.device.enable()){this.active=this.device;return true;}return false;}
  useManual(){this.device.disable();this.active=this.manual;this.manual.reset();}
  isDeviceActive(){return this.active===this.device&&this.device.enabled;}
  async toggleDevice(){if(this.isDeviceActive()){this.useManual();return false;}return this.enableDevice();}
  getGravity(){return this.active.getGravity();}
  calibrate(){this.active.calibrate();}
  reset(){this.active.reset();}
}
