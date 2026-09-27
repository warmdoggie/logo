import {mkdirSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=dirname(fileURLToPath(import.meta.url));
const temp=join(root,'work','test-tmp');
mkdirSync(temp,{recursive:true});
mkdirSync(join(root,'work','tests'),{recursive:true});
const files=readdirSync(root).filter(name=>/^test.*\.mjs$/.test(name)).sort();
const result=spawnSync(process.execPath,['--test',...files],{
 cwd:root,stdio:'inherit',env:{...process.env,TMPDIR:temp,TMP:temp,TEMP:temp}
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
