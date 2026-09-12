const KEY='fluid-pocket-sandbox/setup-v1';
export function serializeSetup(app){return {version:1,box:{...app.sim.env.box},env:{environmentDensity:app.sim.env.environmentDensity,ambientTemperature:app.sim.env.ambientTemperature,gravityStrength:app.sim.env.gravityStrength},rules:{...app.sim.rules},materials:[...app.sim.materials.values()],selectedMaterialId:app.selectedMaterialId,seed:app.seed};}
export function saveSetup(app){localStorage.setItem(KEY,JSON.stringify(serializeSetup(app)));}
export function loadSavedSetup(){try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch{return null;}}
export function exportSetup(app){const blob=new Blob([JSON.stringify(serializeSetup(app),null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='fluid-pocket-setup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export async function importSetupFile(file){const text=await file.text();return JSON.parse(text);}
