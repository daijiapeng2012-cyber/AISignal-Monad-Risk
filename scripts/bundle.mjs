// Fixed, dependency-free modules are flattened to one standard Worker ESM artifact.
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const parts=await Promise.all(['worker/preflight.js','worker/preflight-ui.js','worker/index.js'].map(p=>readFile(new URL(p,root),'utf8')));
const stripExports=s=>s.replace(/^export (const|async function|function)/gm,'$1');
const main=parts[2].replace(/^import .* from '\.\/preflight(?:-ui)?\.js';\n/gm,'');
await writeFile(new URL('dist/server/index.js',root),stripExports(parts[0])+'\n'+stripExports(parts[1])+'\n'+main);
