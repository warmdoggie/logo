import assert from 'node:assert/strict';
import {test} from 'node:test';
import {selectGenerationVersions,generationVersions} from './generation-versions.mjs';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';

test('defaults to four, validates selection and lets a single retry override it',()=>{
 assert.deepEqual(selectGenerationVersions(),['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']);
 for(const selectedVersions of [[],null,['UNKNOWN']])assert.throws(()=>selectGenerationVersions({selectedVersions}));
 assert.deepEqual(selectGenerationVersions({selectedVersions:[],onlyVersion:'BLACK'}),['BLACK']);
});
test('only the chosen three versions create model requests',()=>{
 const selectedVersions=['BLACK','GOLD FOIL','SILVER FOIL'];
 for(const model of ['flux-3-image','gpt-image-2']){
  const plan=buildAiMockupPlan({model,selectedVersions,originalColor:'#000000',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides:generationVersions.map(version=>({version,dataUrl:'data:image/png;base64,GUIDE'}))});
  assert.deepEqual(plan.map(item=>item.version),selectedVersions);
 }
});
