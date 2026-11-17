import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function sidebar({initialRows,promptResult=null,confirmResult=false,deleteStatus=200}={}){
 const node=()=>({children:[],dataset:{},value:'',open:false,showModal(){this.open=true;},close(){this.open=false;},focus(){this.focused=true;},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(){},contentWindow:{postMessage(){}}});
 const elements=Object.fromEntries(['task-list','task-views','task-message','rename-task','task-title','new-task','delete-all-tasks','task-search','task-search-empty','create-task-dialog','create-task-form','new-task-title','create-task-submit','cancel-create-task'].map(id=>[id,node()])),listeners={},timers=[],deleted=[],confirmations=[];
 let rows=initialRows??[{id:'a',title:'任务 1',updatedAt:'2026-10-30T00:00:00Z'}],heldList,heldCreate;const created=[];
 const fetch=async(url,init)=>{
  if(init.method==='DELETE'){deleted.push({url,body:JSON.parse(init.body)});if(deleteStatus!==200)return {ok:false,status:deleteStatus,json:async()=>({error:'接口不存在'})};rows=[];return {ok:true,status:200,json:async()=>({deleted:1})};}
  if(init.method==='PUT')rows[0]={...rows[0],title:JSON.parse(init.body).title,updatedAt:'2026-10-30T02:00:00Z'};
  let value=structuredClone(url.endsWith('/api/session')?{user:{id:'alice'}}:url.endsWith('/api/my-space/tasks')?rows:rows.find(row=>url.includes('/'+row.id))||rows[0]);
  if(init.method==='POST'&&url.endsWith('/api/my-space/tasks')){value={id:'new',title:JSON.parse(init.body).title,updatedAt:'2026-10-30T02:00:00Z'};created.push(value);rows.unshift(value);}
  if(init.method==='POST'&&heldCreate){const held=heldCreate;heldCreate=null;held.enter();await held.pending;}
  if(url.endsWith('/api/my-space/tasks')&&heldList){const held=heldList;heldList=null;held.enter();await held.pending;}
  return {ok:true,status:200,json:async()=>value};
 };
 const context=vm.createContext({document:{querySelector:selector=>elements[selector.slice(1)],createElement:node},window:{confirm:text=>{confirmations.push(text);return confirmResult;},prompt:()=>promptResult,addEventListener:(event,handler)=>{listeners[event]=handler;}},location:{pathname:'/s7/',origin:'http://localhost',hash:''},history:{replaceState(){}},localStorage:{getItem(){},setItem(){},removeItem(){}},URLSearchParams,Map,Date,setTimeout:fn=>timers.push(fn),fetch});
 const source=await readFile(new URL('./tasks.js',import.meta.url),'utf8');
 await vm.runInContext(`(async()=>{${source}\n})()`,context);
 const frame=elements['task-views'].children[0];
 const send=(data,event={})=>listeners.message({origin:'http://localhost',source:frame.contentWindow,data:{type:'s7-task-status',taskId:'a',text:'已保存',...data},...event});
 return {elements,frame,send,created,deleted,confirmations,holdNextCreate:()=>{let release,enter;const pending=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{enter=resolve;});heldCreate={pending,enter};return {started,release};},create:async()=>{elements['new-task'].onclick({currentTarget:elements['new-task']});if(promptResult===null){elements['cancel-create-task'].onclick?.();return;}elements['new-task-title'].value=promptResult;elements['new-task-title'].oninput?.();await elements['create-task-form'].onsubmit?.({preventDefault(){}});},refresh:async()=>{await timers.shift()();},setRows:value=>{rows=value;},rename:async name=>{elements['task-title'].value=name;await elements['rename-task'].onsubmit({preventDefault(){}});},holdNextList:()=>{let release,enter;const pending=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{enter=resolve;});heldList={pending,enter};return {started,release};}};
}

test('点击新建任务只打开页面内名称弹框，未填写前禁止创建',async()=>{
 const {elements,created}=await sidebar();elements['new-task'].onclick({currentTarget:elements['new-task']});
 assert.equal(elements['create-task-dialog'].open,true);assert.equal(elements['new-task-title'].focused,true);
 assert.equal(elements['create-task-submit'].disabled,true);assert.equal(created.length,0);
});

test('创建请求尚未返回时编辑名称或重复提交不会再创建第二个任务',async()=>{
 const {elements,created,create,holdNextCreate}=await sidebar({promptResult:'客户确认版'}),held=holdNextCreate(),pending=create();await held.started;
 try{elements['new-task-title'].value='另一名称';elements['new-task-title'].oninput();assert.equal(elements['create-task-submit'].disabled,true);await elements['create-task-form'].onsubmit({preventDefault(){}});assert.equal(created.length,1);}finally{held.release();await pending;}
});

test('空任务列表只显示创建入口，不自动创建默认任务',async()=>{
 const {created,elements}=await sidebar({initialRows:[]});
 assert.equal(created.length,0);assert.equal(elements['task-views'].children.length,0);
});

test('新建任务使用弹框中填写的名称并打开对应任务',async()=>{
 const {created,create,elements}=await sidebar({promptResult:'  客户确认版  '});await create();
 assert.equal(created.length,1);assert.equal(created[0].title,'客户确认版');
 assert.equal(elements['task-title'].value,'客户确认版');
});

test('取消、空白及超过长度的名称均不创建任务',async()=>{
 for(const promptResult of [null,'','   ','名'.repeat(81)]){
  const {created,create}=await sidebar({promptResult});await create();assert.equal(created.length,0);
 }
});

test('草稿保存后任务栏、当前任务名称和编辑器标题同步返回的名称',async()=>{
 const {elements,frame,send}=await sidebar();
 send({title:'红叶',updatedAt:'2026-10-30T01:00:00Z'});
 assert.equal(elements['task-list'].children[0].children[0].children[0].textContent,'红叶');
 assert.equal(elements['task-title'].value,'红叶');
 assert.equal(frame.title,'任务：红叶');
});

test('已保存名称更新不覆盖正在输入的手动名',async()=>{
 const {elements,send}=await sidebar();
 elements['task-title'].value='我正在填写';
 send({title:'红叶'});
 assert.equal(elements['task-title'].value,'我正在填写');
 assert.equal(elements['task-list'].children[0].children[0].children[0].textContent,'红叶');
});

test('其他来源的消息不能修改任务名称',async()=>{
 const {elements,send}=await sidebar();
 send({title:'伪造名称'},{origin:'http://other.example'});
 send({title:'伪造名称'},{source:{}});
 assert.equal(elements['task-title'].value,'任务 1');
 assert.equal(elements['task-list'].children[0].children[0].children[0].textContent,'任务 1');
});

test('编辑器保存回调将已保存名称同步到任务栏',async()=>{
 const {elements,send}=await sidebar();
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const context=vm.createContext({currentTaskId:'a',status:{classList:{contains:()=>false}},location:{origin:'http://localhost'},window:{parent:{postMessage:data=>send(data)}}});
 vm.runInContext(source.slice(source.indexOf('function notifyTask('),source.indexOf('\n',source.indexOf('function notifyTask('))),context);
 const onSaved=vm.runInContext(source.match(/onSaved:(record=>\{.*?\}),onError:/s)[1],context);
 onSaved({title:'红叶',updatedAt:'2026-10-30T01:00:00Z'});
 assert.equal(elements['task-title'].value,'红叶');
 assert.equal(elements['task-list'].children[0].children[0].children[0].textContent,'红叶');
});

test('定时刷新同步已保存名称和当前名称输入框',async()=>{
 const {elements,frame,refresh,setRows}=await sidebar();
 setRows([{id:'a',title:'保温杯',updatedAt:'2026-10-30T01:00:00Z'}]);
 await refresh();
 assert.equal(elements['task-title'].value,'保温杯');
 assert.equal(frame.title,'任务：保温杯');
});

test('手动改名后返回的旧列表不能覆盖已保存名称',async()=>{
 const {elements,refresh,rename,holdNextList}=await sidebar();
 const held=holdNextList(),poll=refresh();await held.started;
 await rename('客户确认版');held.release();await poll;
 assert.equal(elements['task-title'].value,'客户确认版');
 assert.equal(elements['task-list'].children[0].children[0].children[0].textContent,'客户确认版');
});

test('手动改名后到达的旧草稿消息不能恢复旧名称',async()=>{
 const {elements,rename,send}=await sidebar();
 await rename('客户确认版');
 send({title:'旧名称',updatedAt:'2026-10-30T01:00:00Z'});
 assert.equal(elements['task-title'].value,'客户确认版');
 assert.equal(elements['task-list'].children[0].children[0].children[0].textContent,'客户确认版');
});

test('名称更新消息到达后，旧列表也不能将名称改回',async()=>{
 const {elements,refresh,send,holdNextList}=await sidebar();
 const held=holdNextList(),poll=refresh();await held.started;
 send({title:'红叶',updatedAt:'2026-10-30T01:00:00Z'});held.release();await poll;
 assert.equal(elements['task-title'].value,'红叶');
 assert.equal(elements['task-list'].children[0].children[0].children[0].textContent,'红叶');
});


test('全部删除先提示当前账号全部任务和线上素材，取消时不发送删除请求',async()=>{
 const {elements,deleted,confirmations}=await sidebar();
 await elements['delete-all-tasks'].onclick();
 assert.equal(confirmations.length,1);assert.match(confirmations[0],/全部.*任务/);assert.match(confirmations[0],/线上/);assert.match(confirmations[0],/无法恢复|永久/);
 assert.equal(deleted.length,0);assert.equal(elements['task-views'].children.length,1);
});

test('确认全部删除后清空任务、编辑器和名称表单',async()=>{
 const {elements,deleted}=await sidebar({confirmResult:true});
 await elements['delete-all-tasks'].onclick();
 assert.equal(deleted.length,1);assert.equal(deleted[0].url,'/s7/api/my-space/tasks');assert.equal(deleted[0].body.confirmAll,true);
 assert.equal(elements['task-list'].children.length,0);assert.equal(elements['task-views'].children.length,0);assert.equal(elements['rename-task'].hidden,true);
 assert.equal(elements['delete-all-tasks'].disabled,true);assert.match(elements['task-message'].textContent,/已删除/);
});

test('生成中的任务和空列表不能全部删除',async()=>{
 for(const initialRows of [[],[{id:'a',title:'生成中',updatedAt:'2026-10-30',generation:{status:'running',outputs:[],stages:{a:{}}}}]]){
  const {elements,deleted}=await sidebar({initialRows,confirmResult:true});
  assert.equal(elements['delete-all-tasks'].disabled,true);await elements['delete-all-tasks'].onclick();assert.equal(deleted.length,0);
 }
});


test('旧服务缺少批量删除接口时明确提示重启，不清空仍存在的客户任务',async()=>{
 const {elements,deleted}=await sidebar({confirmResult:true,deleteStatus:404});
 await elements['delete-all-tasks'].onclick();
 assert.equal(deleted.length,1);assert.match(elements['task-message'].textContent,/接口.*未加载/);assert.match(elements['task-message'].textContent,/重启/);
 assert.equal(elements['task-list'].children.length,1);assert.equal(elements['task-views'].children.length,1);assert.equal(elements['delete-all-tasks'].disabled,false);
});


test('客户名称搜索支持中文局部匹配、忽略大小写和首尾空格，清空恢复列表',async()=>{
 const initialRows=[{id:'a',title:'上海客户 Alice',updatedAt:'2026-10-30'},{id:'b',title:'广州客户 Bob',updatedAt:'2026-10-30'}];
 const {elements,frame}=await sidebar({initialRows}),search=elements['task-search'];
 for(const query of ['上海','  ALICE  ']){
  search.value=query;search.oninput();
  assert.equal(elements['task-list'].children.length,1);assert.equal(elements['task-list'].children[0].children[0].dataset.taskId,'a');
 }
 search.value='';search.oninput();assert.equal(elements['task-list'].children.length,2);assert.equal(elements['task-views'].children[0],frame);
});

test('搜索无匹配时显示空状态，继续输入匹配名称后恢复',async()=>{
 const {elements}=await sidebar(),search=elements['task-search'];
 search.value='不存在的客户';search.oninput();assert.equal(elements['task-list'].children.length,0);assert.equal(elements['task-search-empty'].hidden,false);
 search.value='任务';search.oninput();assert.equal(elements['task-list'].children.length,1);assert.equal(elements['task-search-empty'].hidden,true);
});

test('任务名称刷新后按当前搜索词重新筛选',async()=>{
 const {elements,setRows,refresh}=await sidebar(),search=elements['task-search'];
 search.value='客户';search.oninput();assert.equal(elements['task-list'].children.length,0);
 setRows([{id:'a',title:'客户确认版',updatedAt:'2026-10-30T03:00:00Z'}]);await refresh();
 assert.equal(elements['task-list'].children.length,1);assert.equal(search.value,'客户');assert.equal(elements['task-search-empty'].hidden,true);
});

test('搜索只筛选显示，全部删除的确认仍明确包括当前账号所有任务',async()=>{
 const {elements,confirmations,deleted}=await sidebar({initialRows:[{id:'a',title:'上海客户',updatedAt:'2026-10-30'},{id:'b',title:'广州客户',updatedAt:'2026-10-30'}]});
 elements['task-search'].value='上海';elements['task-search'].oninput();await elements['delete-all-tasks'].onclick();
 assert.match(confirmations[0],/2 个客户任务/);assert.equal(deleted.length,0);
});
