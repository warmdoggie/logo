import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LocalStorage} from './storage.mjs';
import {requestScope} from './workspace-auth.mjs';
import {logoLibrary} from './logo-library.mjs';

test('Logo 库保存独立用户素材，返回用户自己的列表并拒绝跨用户访问',async()=>{
 const root=mkdtempSync(join(tmpdir(),'logo-library-')),db=new DatabaseSync(':memory:');
 try{
  const storage=new LocalStorage(join(root,'uploads'));
  const library=logoLibrary(db,storage,()=>requestScope.getStore()?.user?.id||'local');
  const add=(user,name,bytes)=>requestScope.run({user:{id:user}},()=>library.add({name,bytes}));
  const list=user=>requestScope.run({user:{id:user}},()=>library.list());
  const image=(user,id)=>requestScope.run({user:{id:user}},()=>library.image(id));
  const rename=(user,id,name)=>requestScope.run({user:{id:user}},()=>library.rename(id,name));
  const remove=(user,id)=>requestScope.run({user:{id:user}},()=>library.remove(id));
  const a=await add('alice','品牌原图.png',Buffer.from('png-a'));
  const b=await add('bob','AI 加工 Logo.png',Buffer.from('png-b'));
  assert.equal(a.name,'品牌原图.png');
  assert.deepEqual(rename('alice',a.id,'新品牌 Logo'),{...a,name:'新品牌 Logo'});
  assert.throws(()=>rename('alice',a.id,'  '),{status:400});
  assert.throws(()=>rename('bob',a.id,'越权改名'),{status:404});
  assert.deepEqual((await list('alice')).map(item=>item.id),[a.id]);
  assert.deepEqual(await image('alice',a.id),Buffer.from('png-a'));
  assert.throws(()=>image('bob',a.id),{status:404});
  assert.throws(()=>remove('bob',a.id),{status:404});
  await remove('alice',a.id);
  assert.deepEqual(await list('alice'),[]);
  assert.deepEqual((await list('bob')).map(item=>item.id),[b.id]);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
