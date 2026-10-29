import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';

test('预览同步工具默认只盘点本地图片，不索取云凭证、不写文件',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'oss-sync-'));
 try{
  await mkdir(join(dir,'uploads'));await writeFile(join(dir,'uploads','01234567-89ab-cdef-0123-456789abcdef.png'),await sharp({create:{width:20,height:10,channels:3,background:'#abc'}}).png().toBuffer());
  await writeFile(join(dir,'uploads','unrelated.txt'),'keep');
  const run=spawnSync(process.execPath,['sync-logo-previews.mjs','--data-dir',dir],{cwd:new URL('.',import.meta.url),encoding:'utf8',env:{...process.env,LOGO_OSS_PREVIEW_ROLE_ARN:''}});
  assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);assert.equal(report.mode,'dry-run');assert.equal(report.images,1);assert.equal(report.prefix,'s7-logo/previews/v1/');assert.deepEqual(await readdir(dir),['uploads']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
