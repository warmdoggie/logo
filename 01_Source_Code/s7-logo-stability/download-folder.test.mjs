import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';

let folder;
try{folder=await import('./download-folder.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
async function fixture(t){
 const path=await mkdtemp(join(tmpdir(),'s7-folder-download-'));t.after(()=>rm(path,{recursive:true,force:true}));
 function directory(path){return {name:path.split(/[\\/]/).at(-1),async getDirectoryHandle(name,{create=false}={}){const target=join(path,name);try{if(!(await stat(target)).isDirectory())throw new DOMException('File exists','TypeMismatchError');}catch(error){if(error.code!=='ENOENT')throw error;if(!create)throw new DOMException('Missing','NotFoundError');await mkdir(target,{recursive:true});}return directory(target);},async getFileHandle(name){const target=join(path,name);return {async createWritable(){let bytes;return {async write(value){bytes=value;},async close(){await writeFile(target,bytes);},async abort(){}};}};}};}
 return {path,parent:directory(path)};
}
const files=[{url:'/original',name:'1-L0048 · ORIGINAL.png'},{url:'/black',name:'2-L0049 · BLACK.png'}];
const request=async url=>new Response(url==='/original'?'first original PNG':'second original PNG');

test('所选图片按原文件名和字节直接保存到客户文件夹，不生成 ZIP',async t=>{
 assert.equal(typeof folder?.saveDownloadFolder,'function');const {path,parent}=await fixture(t),progress=[];
 const result=await folder.saveDownloadFolder(parent,'上海客户',files,{request,onProgress:(done,total)=>progress.push([done,total])});
 assert.equal(result.name,'上海客户');assert.equal(result.count,2);
 assert.deepEqual((await readdir(join(path,'上海客户'))).sort(),files.map(file=>file.name).sort());
 assert.equal(await readFile(join(path,'上海客户',files[0].name),'utf8'),'first original PNG');
 assert.equal(await readFile(join(path,'上海客户',files[1].name),'utf8'),'second original PNG');
 assert.deepEqual(progress,[[1,2],[2,2]]);
});

test('再次保存创建新文件夹并保留已有文件，包括同名普通文件',async t=>{
 assert.equal(typeof folder?.saveDownloadFolder,'function');const {path,parent}=await fixture(t);
 await mkdir(join(path,'客户'));await writeFile(join(path,'客户','保留.png'),'old');await writeFile(join(path,'客户 (2)'),'occupied');
 assert.equal((await folder.saveDownloadFolder(parent,'客户',files,{request})).name,'客户 (3)');
 assert.equal(await readFile(join(path,'客户','保留.png'),'utf8'),'old');assert.equal(await readFile(join(path,'客户 (2)'),'utf8'),'occupied');
});

test('同时保存同名客户时分别分配目录，不覆盖另一页面的图片',async t=>{
 assert.equal(typeof folder?.saveDownloadFolder,'function');const {path,parent}=await fixture(t);
 const [a,b]=await Promise.all(['first','second'].map(bytes=>folder.saveDownloadFolder(parent,'客户',[files[0]],{request:async()=>new Response(bytes)})));
 assert.notEqual(a.name,b.name);
 assert.equal(await readFile(join(path,a.name,files[0].name),'utf8'),'first');assert.equal(await readFile(join(path,b.name,files[0].name),'utf8'),'second');
});

test('危险或重复文件名在创建文件夹及读取图片前拒绝',async t=>{
 assert.equal(typeof folder?.saveDownloadFolder,'function');const {path,parent}=await fixture(t);let reads=0;
 for(const invalid of [[{url:'/a',name:'../outside.png'}],[files[0],files[0]],[]])await assert.rejects(folder.saveDownloadFolder(parent,'客户',invalid,{request:async()=>{reads++;return new Response('');}}));
 assert.deepEqual(await readdir(path),[]);assert.equal(reads,0);
});

test('图片失败时等待其他写入结束，明确保留的部分图片数量和目录',async t=>{
 assert.equal(typeof folder?.saveDownloadFolder,'function');const {path,parent}=await fixture(t);
 await assert.rejects(folder.saveDownloadFolder(parent,'客户',files,{request:async url=>url==='/original'?new Response('saved'):new Response('',{status:503})}),/客户.*\d.*2/);
 const before=await readdir(join(path,'客户'));await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(await readdir(join(path,'客户')),before);
});

test('下载点击先选择目录再保存草稿及读取清单，取消时不发起下载',async()=>{
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),events=[],button={},picked={name:'downloads'},downloadStatus={hidden:true,dataset:{}};
 const c=vm.createContext({downloadSelectedButton:button,downloadStatus,selectedDownloadOutputs:()=>[{dataUrl:'/s7/api/image.png'}],downloadSelection:{},taskDownloadOutputs:()=>[],downloadingSelected:false,updateDownloadSelection(){},window:{showDirectoryPicker:()=>{events.push('picker');return Promise.resolve(picked);}},taskDraft:{flush:async()=>events.push('flush')},currentTaskId:'task',s7User:{id:'alice'},fetch:async()=>{events.push('manifest');return {ok:true,json:async()=>({folderName:'客户',files})};},saveDownloadFolder:async(parent,name,images)=>{assert.equal(parent,picked);assert.equal(name,'客户');assert.deepEqual(images,files);events.push('save');return {name:'客户',count:2};},setStatus(){},multiPackageProducts:[]});
 vm.runInContext(source.slice(source.indexOf('downloadSelectedButton.onclick='),source.indexOf('function updateSchemeSelection(')),c);
 await button.onclick();assert.deepEqual(events,['picker','flush','manifest','save']);assert.equal(c.downloadingSelected,false);
 events.length=0;c.window.showDirectoryPicker=()=>{events.push('picker');return Promise.reject(new DOMException('cancel','AbortError'));};
 await button.onclick();assert.deepEqual(events,['picker']);assert.equal(c.downloadingSelected,false);assert.equal(downloadStatus.hidden,false);assert.match(downloadStatus.textContent,/已取消/);
});
