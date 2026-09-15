import { clamp } from '../simulation/math.mjs';

export const GRAPHICS_PRESETS=Object.freeze({
  ECO:Object.freeze({representation:'CLOUDS',resolutionScale:.58,renderFraction:.42,cloudCellSize:1.0,effectsScale:.2}),
  BALANCED:Object.freeze({representation:'PARTICLES',resolutionScale:.76,renderFraction:.7,cloudCellSize:.78,effectsScale:.55}),
  DETAIL:Object.freeze({representation:'PARTICLES',resolutionScale:1,renderFraction:1,cloudCellSize:.48,effectsScale:1})
});

export function normalizeGraphicsSettings(input={}){
  const representation=input.representation==='CLOUDS'?'CLOUDS':'PARTICLES';
  return {
    representation,
    resolutionScale:clamp(Number(input.resolutionScale) || .76,.45,1),
    renderFraction:clamp(Number(input.renderFraction) || .7,.2,1),
    cloudCellSize:clamp(Number(input.cloudCellSize) || .78,.35,1.4),
    effectsScale:clamp(Number.isFinite(Number(input.effectsScale))?Number(input.effectsScale):.55,0,1)
  };
}

export function graphicsPreset(name){return normalizeGraphicsSettings(GRAPHICS_PRESETS[name]||GRAPHICS_PRESETS.BALANCED);}
