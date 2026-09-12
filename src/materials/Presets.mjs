import { sanitizeMaterial } from './MaterialDefinition.mjs';
const m=(id,name,color,props)=>sanitizeMaterial({id,name,color,seed:id,opacity:.72,density:1,viscosity:.3,cohesion:.55,miscibility:.5,temperature:.35,heatCapacity:.6,thermalConductivity:.45,meltingTemperature:.18,boilingTemperature:.72,phaseTransitionHysteresis:.025,volatility:.4,reactionPotential:0,compressibility:.55,...props});
export const PRESETS={
  mixing:{name:'MIXING TEST',materials:[m(101,'Azure Heavy','#2d7dff',{miscibility:.50,density:1.45,viscosity:.88,temperature:.25,reactionPotential:-.85}),m(102,'Amber Light','#ff9d2d',{miscibility:.51,density:.74,viscosity:.08,temperature:.72,reactionPotential:.85})]},
  layers:{name:'IMMISCIBLE LAYERS',materials:[m(201,'Dense Violet','#7b4dff',{miscibility:.12,density:1.52,viscosity:.42}),m(202,'Light Gold','#ffd447',{miscibility:.82,density:.72,viscosity:.18})]},
  rain:{name:'RAIN CYCLE',materials:[m(301,'Rain Matter','#67d9ff',{temperature:.88,boilingTemperature:.56,meltingTemperature:.12,density:1.05,volatility:.9,thermalConductivity:.7,compressibility:.85})]},
  freeze:{name:'FREEZE / MELT',materials:[m(401,'Phase Gel','#6cf5c2',{temperature:.31,meltingTemperature:.34,boilingTemperature:.82,viscosity:.45,cohesion:.8})]},
  shock:{name:'THERMAL SHOCK',materials:[m(501,'Hot Ember','#ff4d35',{temperature:.98,boilingTemperature:.9,miscibility:.52,reactionPotential:.4}),m(502,'Cold Cyan','#3de7ff',{temperature:.06,miscibility:.53,reactionPotential:-.4})]}
};
