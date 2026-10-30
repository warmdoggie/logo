import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {userSpace} from './user-space.mjs';

async function fixture(t,title='任务 1'){
 const dir=await mkdtemp(join(tmpdir(),'s7-task-naming-')),spaces=userSpace(dir),user={id:'alice'};
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const task=await spaces.createTask(user,{title});
 const save=async input=>spaces.updateTask(user,task.id,{revision:(await spaces.task(user,task.id)).revision,mergeState:true,summary:true,...input});
 return {dir,spaces,user,task,save};
}
test('保存和替换 Logo、产品不会修改用户输入的任务名，包括任务 1',async t=>{
 const {dir,spaces,user,task,save}=await fixture(t);
 assert.equal((await save({state:{taskLogos:[{id:'red',name:'红叶.png'}]}})).title,'任务 1');
 assert.equal((await save({state:{taskLogos:[{id:'blue',name:'蓝海'}],multiPackageProducts:[{id:'cup',name:'保温杯'}]}})).title,'任务 1');
 assert.equal((await userSpace(dir).task(user,task.id)).title,'任务 1');
 assert.equal((await spaces.tasks(user))[0].title,'任务 1');
});

test('手动修改名称后继续保存素材，刷新仍保留用户设置的名称',async t=>{
 const {dir,spaces,user,task,save}=await fixture(t,'客户初稿');
 assert.equal((await save({title:'客户确认版'})).title,'客户确认版');
 await save({state:{logos:[{id:'a',name:'品牌'}],productId:'cup',productName:'保温杯'}});
 assert.equal((await userSpace(dir).task(user,task.id)).title,'客户确认版');
 assert.equal((await spaces.tasks(user))[0].title,'客户确认版');
});

test('缺少名称、空白或超过 80 字时不创建任务',async t=>{
 const {spaces,user}=await fixture(t,'已有任务');
 for(const title of [undefined,'','   ','名'.repeat(81)])await assert.rejects(spaces.createTask(user,{title}),error=>error.status===400);
 assert.equal((await spaces.tasks(user)).length,1);
});
