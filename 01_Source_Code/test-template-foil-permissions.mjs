import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {automationStore} from './template-automation.mjs';

const zones=[{id:'zone',zoneType:'logo',x:.1,y:.1,width:.8,height:.8}];
const image={width:1000,height:500};
function definition(foilProcesses){
 return {version:1,carriers:[{id:'body',type:'BODY',name:'产品'}],areas:[{id:'area',zoneIndex:0,carrierId:'body',name:'正面',autoEligible:false,presets:[],...(foilProcesses===undefined?{}:{foilProcesses})}],schemes:[]};
}

test('area foil permissions survive normalization and storage without duplicates',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE ProductTemplate(id TEXT PRIMARY KEY); INSERT INTO ProductTemplate VALUES (\'template\');');
  const store=automationStore(db),input=definition(['GOLD FOIL','SILVER FOIL','GOLD FOIL','ROSE GOLD FOIL','LASER FOIL']);
  const normalized=store.normalize(input,zones,image);
  assert.deepEqual(normalized.areas[0].foilProcesses,['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL']);
  store.save('template',normalized,['zone']);
  assert.deepEqual(store.get('template').areas[0].foilProcesses,['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL']);
  assert.equal(store.get('template').areas[0].zoneId,'zone');
 }finally{db.close();}
});

test('legacy areas normalize to no foil permissions',()=>{
 const db=new DatabaseSync(':memory:');
 try{assert.deepEqual(automationStore(db).normalize(definition(),zones,image).areas[0].foilProcesses,[]);}finally{db.close();}
});

for(const value of ['GOLD FOIL',null,['gold foil'],['SPOT UV'],[1]])test('invalid area foil permissions are rejected: '+JSON.stringify(value),()=>{
 const db=new DatabaseSync(':memory:');
 try{assert.throws(()=>automationStore(db).normalize(definition(value),zones,image),e=>e.status===400&&/工艺/.test(e.message));}finally{db.close();}
});
