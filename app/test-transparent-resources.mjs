import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('透明母版页面资源：入口引用、JS/CSS MIME 与本机安全响应头',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{env:{...process.env,APP_DATA_DIR:mkdtempSync(join(tmpdir(),'transparent-assets-')),APP_NO_SEED:'1',PORT:'0'},stdio:['ignore','pipe','pipe']});
 try{
  const base=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.once('error',reject);child.once('exit',c=>reject(Error('startup '+c)));});
  const scripts={};for(const path of ['/automatic-ui.js','/automatic-legacy-ui.js','/transparent-ui.js','/transparent.css','/sales.css','/printing-settings-ui.js']){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),path.endsWith('.css')?/text\/css/:/javascript/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');scripts[path]=await r.text();}
  assert.match(scripts['/automatic-legacy-ui.js'],/import \{mountTransparent\}/);assert.match(scripts['/automatic-legacy-ui.js'],/await mountTransparent/);assert.match(scripts['/automatic-ui.js'],/\/api\/sales\//);assert.match(scripts['/transparent-ui.js'],/link.href='\/transparent.css'/);
 }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
});
