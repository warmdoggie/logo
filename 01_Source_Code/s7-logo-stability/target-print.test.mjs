import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {renderLogoSet} from './index.mjs';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {resolveTargetPrint} from './target-print.mjs';

const versions=['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'];
const targets=[
  {id:'tube',x:.2,y:.5,widthRatio:.12,carrierType:'BODY'},
  {id:'front',x:.5,y:.5,widthRatio:.12,carrierType:'CARTON_FRONT',color:'#C54B78',autoContrast:true},
  {id:'back',x:.8,y:.5,widthRatio:.12,carrierType:'CARTON_BACK',color:'#235689'}
];

test('fixed body finishes override output versions and ordinary ink ignores automatic contrast',()=>{
  assert.deepEqual(resolveTargetPrint({carrierType:'BODY',printFinish:'SILVER FOIL'},'BLACK'),{carrierType:'BODY',printFinish:'SILVER FOIL',version:'SILVER FOIL',color:'#BFC3C9',finish:'silver'});
  assert.equal(resolveTargetPrint({printFinish:'INK',color:'#235689',autoContrast:true},'GOLD FOIL','#000000','#FFFFFF').color,'#235689');
  for(const target of [{carrierType:'unknown'},{printFinish:'unknown'},{carrierType:'CARTON_BACK',printFinish:'GOLD FOIL'}])assert.throws(()=>resolveTargetPrint(target,'ORIGINAL'));
});

test('preserving original logo colors leaves source pixels untinted until a custom color is selected',()=>{
  assert.equal(resolveTargetPrint({printFinish:'INK',color:'#000000',preserveOriginalColor:true},'GOLD FOIL','#000000').color,null);
  assert.equal(resolveTargetPrint({printFinish:'INK',color:'#C54B78',preserveOriginalColor:false},'ORIGINAL').color,'#C54B78');
});

test('carton front and back retain separate ink colors in every version while the body changes finish',async()=>{
  const baseImage=await sharp({create:{width:100,height:40,channels:4,background:'#ffffff'}}).png().toBuffer();
  const logoImage=await sharp({create:{width:8,height:4,channels:4,background:'#000000'}}).png().toBuffer();
  const result=await renderLogoSet({baseImage,logoImage,targets});
  for(const output of result.outputs){
    const raw=await sharp(output.bytes).ensureAlpha().raw().toBuffer();
    assert.deepEqual([...raw.subarray((20*100+50)*4,(20*100+50)*4+3)],[197,75,120],output.version);
    assert.deepEqual([...raw.subarray((20*100+80)*4,(20*100+80)*4+3)],[35,86,137],output.version);
    if(output.version==='GOLD FOIL')assert.notDeepEqual([...raw.subarray((20*100+20)*4,(20*100+20)*4+3)],[0,0,0]);
  }
});

test('cartons reject explicit foil even when the API is called directly',async()=>{
  const image=await sharp({create:{width:100,height:40,channels:4,background:'#ffffff'}}).png().toBuffer();
  for(const printFinish of ['GOLD FOIL','SILVER FOIL'])await assert.rejects(
    renderLogoSet({baseImage:image,logoImage:image,targets:[{...targets[1],printFinish}]}),/彩盒.*普通/);
});

for(const model of ['gpt-image-2','flux-3-image'])test(`${model} receives per-placement ink constraints instead of a global foil instruction`,()=>{
  const plan=buildAiMockupPlan({model,baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',originalColor:'#000000',targets,
    guides:versions.map(version=>({version,dataUrl:'data:image/png;base64,GUIDE'}))});
  const prompt=plan.find(item=>item.version==='GOLD FOIL').request.prompt;
  assert.match(prompt,/front[^\n]*CARTON_FRONT[^\n]*#C54B78[^\n]*ordinary ink/i);
  assert.match(prompt,/back[^\n]*CARTON_BACK[^\n]*#235689[^\n]*ordinary ink/i);
  assert.match(prompt,/tube[^\n]*GOLD FOIL/);
  assert.match(prompt,/No gold foil, silver foil or metallic reflection on carton/i);
});

for(const model of ['gpt-image-2','flux-3-image'])test(`${model} defers auto black-white contrast to the sampled placement guide`,()=>{
  const [plan]=buildAiMockupPlan({model,baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',originalColor:'#000000',onlyVersion:'BLACK',
    targets:[{...targets[0],autoContrast:true}],guides:[{version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_WHITE_LOGO'}]});
  assert.match(plan.request.prompt,/color black or white from the placement guide/);
  assert.doesNotMatch(plan.request.prompt,/color #000000|"color":"#000000"/);
});

test('master semantic carriers identify carton faces without changing the saved geometry',()=>{
  const result=masterTargetsFromTemplate({zones:[
    {id:'a',name:'正面 Logo',zoneType:'logo',x:.1,y:.2,width:.2,height:.1},
    {id:'b',name:'彩盒背面 Logo',zoneType:'logo',x:.6,y:.2,width:.2,height:.1}
  ],automation:{carriers:[{id:'carton',type:'CARTON'}],areas:[{zoneId:'a',zoneIndex:0,carrierId:'carton'}]}});
  assert.equal(result[0].carrierType,'CARTON_FRONT');
  assert.equal(result[1].carrierType,'CARTON_BACK');
  assert.equal(result[0].x,.2);
  assert.equal(result[1].widthRatio,.2);
});

test('unpublished carrier indices count non-logo zones and use the semantic area face name',()=>{
  const result=masterTargetsFromTemplate({zones:[{id:'guard',zoneType:'no-logo'},
    {id:'body',name:'产品',zoneType:'logo',x:.1,y:.2,width:.2,height:.1},
    {id:'box',name:'Logo',zoneType:'logo',x:.6,y:.2,width:.2,height:.1}
  ],automation:{carriers:[{id:'carton',type:'CARTON'}],areas:[{zoneIndex:2,carrierId:'carton',name:'彩盒背面'}]}});
  assert.equal(result[0].carrierType,undefined);
  assert.equal(result[1].carrierType,'CARTON_BACK');
});
