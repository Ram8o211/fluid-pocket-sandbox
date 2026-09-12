import { spawnSync } from 'node:child_process';import { existsSync } from 'node:fs';
const args=['-p','jsconfig.json'];const r=spawnSync('tsc',args,{stdio:'inherit',shell:true});if(r.error||r.status===127){console.warn('tsc not available; falling back to syntax lint');const f=spawnSync(process.execPath,['scripts/lint.mjs'],{stdio:'inherit'});process.exit(f.status||0);}process.exit(r.status||0);
