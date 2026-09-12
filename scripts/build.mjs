import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const p of ['index.html','styles.css','src','public'])await cp(p,p==='public'?'dist':'dist/'+p,{recursive:true});
console.log('Built static dist/');
