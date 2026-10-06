import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clearSavedLogo,loadSavedLogo,saveLogo} from './saved-logo.mjs';

function memoryStorage(){
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}

test('processed transparent logo is restored after a page reload',()=>{
  const storage=memoryStorage();
  saveLogo(storage,{data:'iVBORw0KGgo=',name:'AI processed logo.png'});
  assert.deepEqual(loadSavedLogo(storage),{data:'iVBORw0KGgo=',name:'AI processed logo.png'});
});

test('saved transparent logo retains its original upload for automatic matching',()=>{
  const storage=memoryStorage();
  saveLogo(storage,{data:'processed-png',name:'AI processed logo.png',sourceData:'original-upload'});
  assert.deepEqual(loadSavedLogo(storage),{data:'processed-png',name:'AI processed logo.png',sourceData:'original-upload'});
});

test('clearing the saved logo removes it from browser storage',()=>{
  const storage=memoryStorage();
  saveLogo(storage,{data:'iVBORw0KGgo=',name:'AI processed logo.png'});
  clearSavedLogo(storage);
  assert.equal(loadSavedLogo(storage),null);
});
