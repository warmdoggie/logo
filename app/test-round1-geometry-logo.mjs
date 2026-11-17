import {test} from 'node:test';import assert from 'node:assert/strict';
import {resizeCentered,centeredDimensions} from './public/center-resize.js';
import {zonePoints} from './public/zone-geometry.js';
import {autoPlace} from './public/auto-placement.js';
import {automationStore} from './template-automation.mjs';import {DatabaseSync} from 'node:sqlite';
import {sharp,analyzePixels} from './logo-pixels.mjs';
import {preflightIssuePresentation,preflightIssueType} from './public/preflight-issues.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);
test('四角、边缘与旋转区域均围绕原中心缩放，边界只限制大小',()=>{
 const image={width:1200,height:800},base={x:.3,y:.2,width:.2,height:.3,rotation:0};
 for(const handle of ['nw','ne','se','sw','n','e','s','w'])for(const rotation of [0,35,90]){
  const b=resizeCentered({...base,rotation},handle,{x:.04,y:.06},image);
  near(b.x+b.width/2,.4);near(b.y+b.height/2,.35);assert.equal(b.rotation,rotation);
 }
 const b=resizeCentered({...base,rotation:35},'se',{x:4,y:4},image);
 near(b.x+b.width/2,.4);near(b.y+b.height/2,.35);assert.ok(zonePoints({...b,shapeType:'ROTATED_RECT'},image).every(p=>p.x>=-1e-8&&p.y>=-1e-8&&p.x<=1+1e-8&&p.y<=1+1e-8));
 const n=centeredDimensions(base,.4,.5);near(n.x+n.width/2,.4);near(n.y+n.height/2,.35);
});
test('绿色范围与Logo方向独立，90度适配竖框且非正方底图尺寸正确',()=>{
 const image={width:1000,height:1500},logo={width:250,height:100},zone={zoneType:'logo',x:.3,y:.2,width:.4,height:.6,maxLogoWidthRatio:1,maxLogoHeightRatio:1};
 const preset={orientation:'vertical',logoRotation:90,box:{centerX:.5,centerY:.5,width:.1,height:.3,rotation:0}};
 const p=autoPlace(zone,preset,[zone],image,logo);assert.equal(p.rotation,90);near(p.widthRatio,.25);near(p.x,.5);near(p.y,.5);assert.equal(preset.box.rotation,0);
 const old={orientation:'custom',box:{...preset.box,rotation:90}};near(autoPlace(zone,old,[zone],image,logo).widthRatio,.1);
});
test('发布保存独立Logo角度；旧预设不重写，新字段拒绝无效值',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ProductTemplate(id TEXT PRIMARY KEY)');const store=automationStore(db),zone={zoneType:'logo',x:.1,y:.1,width:.8,height:.8};
 const p={id:'p',name:'默认',isDefault:true,orientation:'vertical',logoRotation:90,box:{centerX:.5,centerY:.5,width:.1,height:.3,rotation:0}},v={version:2,carriers:[{id:'c',type:'BODY',name:'产品'}],areas:[{id:'a',carrierId:'c',name:'产品',zoneIndex:0,autoEligible:true,printing:{allowed:['SCREEN_PRINT'],defaultProcess:'SCREEN_PRINT',ink:'BLACK'},presets:[p]}]};
 assert.equal(store.normalize(v,[zone],{width:1000,height:1500}).areas[0].presets[0].logoRotation,90);
 p.logoRotation=NaN;assert.throws(()=>store.normalize(v,[zone],{width:1000,height:1500}),/Logo 角度/);delete p.logoRotation;p.box.rotation=90;
 assert.equal('logoRotation' in store.normalize(v,[zone],{width:1000,height:1500}).areas[0].presets[0],false);db.close();
});
test('旧母版独立保存框角度与横竖方向，重新读取后仍按所选方向摆放',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ProductTemplate(id TEXT PRIMARY KEY)');
 try{
  const store=automationStore(db),image={width:1000,height:1500},zone={id:'zone',zoneType:'logo',x:.1,y:.1,width:.8,height:.8,maxLogoWidthRatio:1,maxLogoHeightRatio:1},logo={width:250,height:100};
  for(const version of [1,2])for(const [orientation,rotation,want] of [['vertical',0,90],['vertical',35,90],['horizontal',35,0],['custom',35,35]]){
   const preset={id:'p',name:'默认',orientation,isDefault:true,box:{centerX:.5,centerY:.5,width:.2,height:.3,rotation}},input={version,carriers:[{id:'c',type:'BODY',name:'产品'}],areas:[{id:'a',carrierId:'c',name:'产品',zoneIndex:0,autoEligible:true,printing:{allowed:['SCREEN_PRINT'],defaultProcess:'SCREEN_PRINT',ink:'BLACK'},presets:[preset]}],schemes:[]};
   const definition=store.normalize(input,[zone],image),id=`template-${version}-${orientation}-${rotation}`;
   db.prepare('INSERT INTO ProductTemplate VALUES (?)').run(id);store.save(id,definition,['zone']);
   const saved=store.get(id).areas[0].presets[0];assert.deepEqual(saved,preset);assert.equal(autoPlace(zone,saved,[zone],image,logo).rotation,want);
  }
 }finally{db.close();}
});
test('独立 Logo 角度仍拒绝与明确横竖方向冲突的值',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const store=automationStore(db),zone={zoneType:'logo',x:0,y:0,width:1,height:1};
  for(const [orientation,logoRotation] of [['horizontal',90],['vertical',0]]){
   const input={version:1,carriers:[{id:'c',type:'BODY',name:'产品'}],areas:[{id:'a',carrierId:'c',name:'产品',zoneIndex:0,autoEligible:true,presets:[{id:'p',name:'默认',orientation,logoRotation,isDefault:true,box:{centerX:.5,centerY:.5,width:.2,height:.2,rotation:0}}]}],schemes:[]};
   assert.throws(()=>store.normalize(input,[zone],{width:1000,height:1500}),/Logo 角度与方向不一致/);
  }
 }finally{db.close();}
});
async function analysis(svg){const {data,info}=await sharp(Buffer.from(svg)).png().ensureAlpha().raw().toBuffer({resolveWithObject:true});return analyzePixels(data,info.width,info.height);}
test('细字透明单色的抗锯齿不是渐变，真正渐变与内容透明仍需识别',async()=>{
 const a=await analysis('<svg width="730" height="134"><text x="4" y="100" font-family="Arial" font-size="90" fill="#66283b">curtobeauty</text></svg>');
 assert.equal(a.estimatedColorCount,1);assert.equal(a.analysisConfidence,'HIGH');assert.equal(a.hasGradient,false);assert.equal(a.hasTransparency,false);assert.ok(a.antialiasPixels>0);
 const g=await analysis('<svg width="300" height="150"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect x="20" y="20" width="250" height="100" fill="url(#g)"/></svg>');assert.notEqual(g.analysisConfidence,'HIGH');assert.notEqual(g.hasGradient,false);
 const semi=await analysis('<svg width="300" height="150"><rect x="20" y="20" width="250" height="100" opacity=".5" fill="black"/></svg>');assert.equal(semi.hasTransparency,true);
 const many=await analysis('<svg width="300" height="150">'+['red','blue','green','orange','purple'].map((c,i)=>`<rect x="${i*60}" y="10" width="50" height="100" fill="${c}"/>`).join('')+'</svg>');assert.ok(many.estimatedColorCount>=4);assert.notEqual(many.analysisConfidence,'HIGH');
});
test('Logo待核对、真实工艺禁止及其他待补内容有不同提示',()=>{
 const type=preflightIssueType({overallStatus:'NEED_INFO',matchedRules:[{result:'NEED_INFO',message:'Logo 色数未知'}]});assert.equal(type,'LOGO_REVIEW');assert.equal(preflightIssuePresentation([{issueType:type}]).title,'Logo 颜色信息待确认');
 assert.equal(preflightIssuePresentation([{issueType:'PROCESS_BLOCK'}]).title,'部分产品不支持所选工艺');assert.equal(preflightIssuePresentation([{issueType:'REVIEW',reason:'缺少母版'}]).title,'部分效果需要处理');
});
