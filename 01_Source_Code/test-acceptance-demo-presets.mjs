import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoAutomation} from './acceptance-demo.mjs';

test('演示母版提供默认、大号横排和竖排摆放预设',()=>{
 const definition=demoAutomation();
 assert.equal(definition.areas.length,2);
 for(const area of definition.areas){
  assert.deepEqual(area.presets.map(p=>p.name),['默认','大号横排','竖排']);
  assert.equal(area.presets.filter(p=>p.isDefault).length,1);
  assert.equal(area.presets.find(p=>p.name==='默认').orientation,'horizontal');
  assert.equal(area.presets.find(p=>p.name==='大号横排').orientation,'horizontal');
  assert.equal(area.presets.find(p=>p.name==='竖排').orientation,'vertical');
  assert.equal(area.presets.find(p=>p.name==='竖排').box.rotation,90);
 }
 assert.deepEqual(definition.schemes[0].targets.map(t=>t.presetId),['preset0','preset1']);
});
