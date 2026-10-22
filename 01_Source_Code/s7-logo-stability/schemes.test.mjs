import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createSchemes,editScheme,restoreSharedGeometry,schemeTargets,schemeSignature} from './schemes.mjs';
import {renderLogoSet} from './index.mjs';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';

const targets=[{id:'body',x:.25,y:.5,widthRatio:.15,carrierType:'BODY',printFinish:'VERSION',color:'#C54B78'},
  {id:'box',x:.75,y:.5,widthRatio:.15,carrierType:'CARTON_FRONT',printFinish:'INK',color:'#235689',autoContrast:true}];

test('four schemes share placement but default carton black-white only in the black-white scheme',()=>{
  const state=createSchemes(targets);
  assert.equal(state.schemes.length,4);
  assert.equal(schemeTargets(state,'BLACK')[1].printFinish,'BLACK');
  assert.equal(schemeTargets(state,'GOLD FOIL')[1].printFinish,'INK');
  assert.equal(schemeTargets(state,'SILVER FOIL')[0].printFinish,'VERSION');
  assert.notEqual(state.schemes[0].targets,state.schemes[1].targets);
});

test('common geometry updates all linked schemes without copying colors or finishes',()=>{
  let state=createSchemes(targets);
  const edited=structuredClone(schemeTargets(state,'GOLD FOIL'));edited[0].x=.35;edited[1].color='#FFFFFF';
  state=editScheme(state,'GOLD FOIL',edited,true);
  assert.equal(schemeTargets(state,'ORIGINAL')[0].x,.35);
  assert.equal(schemeTargets(state,'ORIGINAL')[1].color,'#235689');
  assert.equal(schemeTargets(state,'GOLD FOIL')[1].color,'#FFFFFF');
});

test('independent placement stays independent until explicitly restored',()=>{
  let state=createSchemes(targets),edited=structuredClone(schemeTargets(state,'SILVER FOIL'));edited[0].x=.4;
  state=editScheme(state,'SILVER FOIL',edited,false);
  edited=structuredClone(schemeTargets(state,'ORIGINAL'));edited[0].x=.3;
  state=editScheme(state,'ORIGINAL',edited,true);
  assert.equal(schemeTargets(state,'SILVER FOIL')[0].x,.4);
  state=restoreSharedGeometry(state,'SILVER FOIL');
  assert.equal(schemeTargets(state,'SILVER FOIL')[0].x,.3);
});

test('scheme signatures ignore editing controls but track production changes',()=>{
  const a={version:'ORIGINAL',targets},b=structuredClone(a);b.targets[0].moveEnabled=true;
  assert.equal(schemeSignature(a,'assets'),schemeSignature(b,'assets'));
  b.targets[0].color='#000000';assert.notEqual(schemeSignature(a,'assets'),schemeSignature(b,'assets'));
  assert.notEqual(schemeSignature(a,'assets'),schemeSignature(a,'new logo'));
});

test('physical carton classification applies across schemes and safely replaces incompatible foil',()=>{
  let state=createSchemes(targets);
  state.schemes.find(s=>s.version==='SILVER FOIL').independentGeometry=true;
  state.schemes.find(s=>s.version==='GOLD FOIL').targets[0].printFinish='GOLD FOIL';
  const edited=structuredClone(schemeTargets(state,'ORIGINAL'));edited[0].carrierType='CARTON_FRONT';edited[0].printFinish='INK';
  state=editScheme(state,'ORIGINAL',edited,false);
  assert.equal(state.sharedTargets[0].carrierType,'CARTON_FRONT');
  for(const scheme of state.schemes){assert.equal(scheme.targets[0].carrierType,'CARTON_FRONT');assert.ok(['INK','BLACK'].includes(scheme.targets[0].printFinish));}
});

test('different geometry and colors reach each guide, mask and model request',async()=>{
  const state=createSchemes(targets);state.schemes.find(s=>s.version==='GOLD FOIL').targets[1].color='#FFFFFF';
  state.schemes.find(s=>s.version==='SILVER FOIL').targets[0].x=.4;
  const baseImage=await sharp({create:{width:100,height:50,channels:4,background:'#222222'}}).png().toBuffer();
  const logoImage=await sharp({create:{width:10,height:5,channels:4,background:'#000000'}}).png().toBuffer();
  const rendered=await renderLogoSet({baseImage,logoImage,targets,schemes:state.schemes});
  const gold=rendered.outputs.find(s=>s.version==='GOLD FOIL'),silver=rendered.outputs.find(s=>s.version==='SILVER FOIL');
  const raw=await sharp(gold.bytes).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...raw.subarray((25*100+75)*4,(25*100+75)*4+3)],[255,255,255]);
  assert.notEqual(gold.bounds[0].left,silver.bounds[0].left);
  assert.ok(gold.mask);assert.ok(silver.mask);
  const plan=buildAiMockupPlan({model:'flux-3-image',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',originalColor:'#000000',targets,schemes:state.schemes,
    guides:rendered.outputs.map(s=>({version:s.version,dataUrl:`data:image/png;base64,${s.bytes.toString('base64')}`,maskDataUrl:`data:image/png;base64,${s.mask.toString('base64')}`}))});
  assert.match(plan.find(s=>s.version==='GOLD FOIL').request.prompt,/box[^\n]*#FFFFFF/);
  assert.match(plan.find(s=>s.version==='SILVER FOIL').request.prompt,/"tgt_bbox":\[425,325,575,475\]/);
  assert.equal(plan[2].maskImage,`data:image/png;base64,${gold.mask.toString('base64')}`);
});

test('malformed scheme sets are rejected rather than silently falling back to a different appearance',()=>{
  for(const schemes of [[{version:'GOLD FOIL',targets:[]}],[{version:'INVALID',targets}],[{version:'ORIGINAL',targets},{version:'ORIGINAL',targets}]])
    assert.throws(()=>schemeTargets({targets,schemes},'ORIGINAL'));
});
