import test from 'node:test';
import assert from 'node:assert/strict';
import * as taskState from './task-draft.mjs';
const {createTaskDraft}=taskState;

test('切换尚未加载完成就刷新时，草稿原图仍归属于原产品',()=>{
 assert.equal(typeof taskState.restoredBaseProduct,'function');
 const products=[{id:'a',sku:'A',name:'甲'},{id:'b',sku:'B',name:'乙'}];
 assert.equal(taskState.restoredBaseProduct({selectedMultiProductId:'b',baseName:'产品库：A · 甲'},products).id,'a');
 assert.equal(taskState.restoredBaseProduct({selectedMultiProductId:'b',baseProductId:'a',baseName:'旧名称'},products).id,'a');
 assert.equal(taskState.restoredBaseProduct({selectedMultiProductId:'b'},products).id,'b');
 assert.equal(taskState.restoredBaseProduct({selectedMultiProductId:'b',baseProductId:'a',baseName:'产品库：A · 甲'},products.slice(1)),undefined);
 assert.equal(taskState.restoredBaseProduct({selectedMultiProductId:'b',baseName:'产品库：A · 甲'},products.slice(1)),undefined);
});
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
 await draft.load();draft.activate();const first=draft.flush();await started;state={logoData:'latest'};const second=draft.flush();assert.equal(saved.length,1);release();await Promise.all([first,second]);assert.deepEqual(saved,[{revision:3,state:{logoData:'first'},mergeState:true,summary:true},{revision:4,state:{logoData:'latest'},mergeState:true,summary:true}]);
});

test('修改布局只传变动字段，未修改的图片不重复上传，返回摘要即可继续保存',async()=>{
 const image='A'.repeat(1024*1024);let state={baseData:image,targets:[{x:.2}]};const writes=[];
 const draft=createTaskDraft({id:'large',capture:()=>state,request:async(_path,body)=>{if(!body)return {revision:4,state:structuredClone(state)};writes.push(body);return {revision:body.revision+1};}});
 await draft.load();draft.activate();state={...state,targets:[{x:.4}]};await draft.flush();
 assert.equal(writes.length,1);assert.equal(writes[0].mergeState,true);assert.equal(writes[0].summary,true);assert.deepEqual(writes[0].state,{targets:[{x:.4}]});
 await draft.flush();assert.equal(writes.length,1,'未修改时不重复保存');
});

test('未改动的保存结束后，后续编辑仍能正常保存',async()=>{
 let state={x:1};const writes=[];
 const draft=createTaskDraft({id:'no-op',delay:10000,capture:()=>state,request:async(_path,body)=>{if(!body)return {revision:0,state:{x:1}};writes.push(body);return {revision:1};}});
 await draft.load();draft.activate();await draft.flush();state={x:2};draft.schedule();await draft.flush();assert.equal(writes.length,1);assert.deepEqual(writes[0].state,{x:2});assert.equal(draft.isDirty(),false);
});
