import { clamp, saturate } from '../simulation/math.mjs';
import { materialVector, weightedMaterialMean } from '../materials/MaterialDefinition.mjs';
export function miscibilityDelta(a,b){ return Math.abs(a.miscibility-b.miscibility); }
export function compatibility(a,b,threshold){ return threshold<=0?0:clamp(1-miscibilityDelta(a,b)/threshold,0,1); }
export function reactionRate(a,b,rules,contactFactor=1){ const c=compatibility(a,b,rules.miscibilityThreshold); return rules.baseMixingRate*Math.pow(c,rules.mixingExponent)*saturate(contactFactor); }
export function propertyDistance(a,b){ const av=materialVector(a),bv=materialVector(b); let s=0,w=0; for(let i=0;i<av.length;i++){ const wi=(i===3?0.25:(i>=12?0.45:1)); const d=av[i]-bv[i]; s+=wi*d*d; w+=wi; } return saturate(Math.sqrt(s/w)*1.9); }
export function visualIntensity(a,b,rules,contactFactor=1){ return saturate(compatibility(a,b,rules.miscibilityThreshold)*propertyDistance(a,b)*saturate(contactFactor)*rules.reactionStrength); }
export function canMix(a,b,threshold){ return miscibilityDelta(a,b)<threshold; }
export { weightedMaterialMean };
