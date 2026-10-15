import test from 'node:test';
import assert from 'node:assert/strict';
import * as taskState from './task-draft.mjs';
const {createTaskDraft}=taskState;
test('恢复已重生成的结果时，不会重新套用旧生成记录的图片',()=>{
 const normalize=taskState.normalizeTaskResult||((payload)=>payload);
 const initial=normalize({outputs:[{version:'BLACK',dataUrl:'data:old'}],savedRecord:{images:[{label:'BLACK',url:'/old.png'}]}});
 assert.equal(initial.savedRecord,undefined);
 initial.outputs[0].dataUrl='/new.png';
 assert.equal(normalize(JSON.parse(JSON.stringify(initial))).outputs[0].dataUrl,'/new.png');
});
test('任务草稿按所属 ID 保存，等待前一次保存后再保存最新状态',async()=>{
 let state={logoData:'first'},release,entered;const started=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;});const saved=[];
 const draft=createTaskDraft({id:'task-a',capture:()=>structuredClone(state),request:async(path,body)=>{assert.equal(path,'/api/my-space/tasks/task-a');if(!body)return {revision:3,state:{}};saved.push(body);if(saved.length===1){entered();await hold;}return {revision:body.revision+1};}});
 await draft.load();draft.activate();const first=draft.flush();await started;state={logoData:'latest'};const second=draft.flush();assert.equal(saved.length,1);release();await Promise.all([first,second]);assert.deepEqual(saved,[{revision:3,state:{logoData:'first'}},{revision:4,state:{logoData:'latest'}}]);
});
