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

test('a full browser cache does not discard a successfully processed logo or restore the stale logo',()=>{
  const storage=memoryStorage(),latest={data:'large-processed-png',name:'new.png',sourceData:'large-original'};
  saveLogo(storage,{data:'old-png',name:'old.png'});
  storage.setItem=()=>{throw new DOMException('quota exceeded','QuotaExceededError');};
  assert.doesNotThrow(()=>saveLogo(storage,latest));
  assert.deepEqual(loadSavedLogo(storage),latest);
  assert.equal(storage.getItem('s7-logo-stability.saved-logo.v1'),null);
  clearSavedLogo(storage);
  assert.equal(loadSavedLogo(storage),null);
});

test('unavailable browser storage still allows using and clearing the current processed logo',()=>{
  const unavailable=()=>{throw new DOMException('blocked','SecurityError');};
  const storage={getItem:unavailable,setItem:unavailable,removeItem:unavailable},logo={data:'processed-png',name:'new.png'};
  assert.doesNotThrow(()=>saveLogo(storage,logo));
  assert.deepEqual(loadSavedLogo(storage),logo);
  assert.doesNotThrow(()=>clearSavedLogo(storage));
  assert.equal(loadSavedLogo(storage),null);
});
