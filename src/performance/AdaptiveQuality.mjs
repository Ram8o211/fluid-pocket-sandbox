export class AdaptiveQuality {
  constructor(){this.mode='MEDIUM';this.avg=16.7;this.frames=0;this.effectsScale=1;this.iterations=2;}
  sample(ms){this.avg=this.avg*.95+ms*.05;this.frames++;if(this.frames%120!==0)return null;if(this.avg>27&&this.mode!=='LOW'){this.mode='LOW';this.iterations=1;this.effectsScale=.55;return this.mode;}if(this.avg<18&&this.mode==='LOW'){this.mode='MEDIUM';this.iterations=2;this.effectsScale=1;return this.mode;}return null;}
  setMode(mode){this.mode=mode;this.iterations=mode==='LOW'?1:mode==='HIGH'?3:2;this.effectsScale=mode==='LOW'?.55:mode==='HIGH'?1.25:1;}
  particleTarget(){return this.mode==='LOW'?450:this.mode==='HIGH'?1500:850;}
}
