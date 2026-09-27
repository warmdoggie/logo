import {sharp} from './logo-pixels.mjs';

export function demoAutomation(){
 const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
 const areas=[0,1].map(i=>{
  const centerX=(i?.6:.12)+.125,areaId='area'+i,presetId='preset'+i;
  return {id:areaId,carrierId:i?'carton':'body',name:i?'彩盒正面':'瓶身',zoneIndex:i,autoEligible:true,presets:[
   {id:presetId,name:'默认',orientation:'horizontal',isDefault:true,box:{centerX,centerY:.45,width:.15,height:.08,rotation:0}},
   {id:presetId+'-large',name:'大号横排',orientation:'horizontal',isDefault:false,box:{centerX,centerY:.45,width:.19,height:.1,rotation:0}},
   {id:presetId+'-vertical',name:'竖排',orientation:'vertical',isDefault:false,box:{centerX,centerY:.45,width:.1,height:.16,rotation:90}}
  ]};
 });
 return {carriers:[.12,.6].map((x,i)=>({id:i?'carton':'body',type:i?'CARTON':'BODY',name:i?'彩盒':'本体',surfaceMask:{reviewed:true,reviewNote:'合成图内部矩形，避开圆角；非实际产品蒙版',regions:[{mode:'INCLUDE',points:rect(x+.025,.175,.2,.65)}]}})),areas,schemes:[{id:'A',name:'本体与彩盒',role:'DEFAULT',targets:[{areaId:'area0',presetId:'preset0'},{areaId:'area1',presetId:'preset1'}]},{id:'B',name:'仅彩盒Logo',role:'ALTERNATIVE',targets:[{areaId:'area1',presetId:'preset1'}]}]};
}

export async function prepareDemo(base){
 const api=async(p,v)=>{const f=v instanceof FormData,r=await fetch(base+p,v===undefined?{}:{method:'POST',headers:f?{}:{'Content-Type':'application/json'},body:f?v:JSON.stringify(v)}),d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;};
 let product=(await api('/api/products')).find(p=>p.sku==='QA-DEMO-001');
 if(!product){const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><defs><linearGradient id="g"><stop stop-color="#999"/><stop offset=".5" stop-color="#eee"/><stop offset="1" stop-color="#aaa"/></linearGradient></defs><rect width="1000" height="700" fill="#f5f5f5"/><rect x="120" y="100" width="250" height="500" rx="20" fill="url(#g)"/><rect x="600" y="100" width="250" height="500" fill="url(#g)"/></svg>',f=new FormData();f.set('sku','QA-DEMO-001');f.set('name','验收演示：本体和彩盒（合成图）');f.set('category','验收演示');f.set('image',new Blob([await sharp(Buffer.from(svg)).png().toBuffer()]),'demo.png');product=await api('/api/products',f);}
 const templatePage=await api('/api/templates/'+product.id),currentTemplate=templatePage.template;
 if(!currentTemplate){const zones=[.12,.6].map((x,i)=>({zoneType:'logo',shapeType:'RECT',name:i?'彩盒':'本体',x:x+.02,y:.3,width:.21,height:.3,defaultAnchorX:x+.125,defaultAnchorY:.45,maxLogoWidthRatio:.21,maxLogoHeightRatio:.3,defaultRotation:0,allowRotation:true,orientation:'free',isDefault:!i,note:'合成演示图'}));
  await api('/api/templates/'+product.id,{baseVersion:0,changeNote:'验收合成模板',zones,automation:demoAutomation()});
 }else if(currentTemplate.automation?.areas?.some(a=>a.presets.length===1)){
  await api('/api/templates/'+product.id,{baseVersion:templatePage.currentVersion,changeNote:'补充演示摆放预设',zones:currentTemplate.zones.map(z=>({...z,allowRotation:!!z.allowRotation,isDefault:!!z.isDefault})),automation:demoAutomation()});
 }
 let task=(await api('/api/tasks')).find(t=>t.customerName==='本机验收演示（合成素材）');
 if(!task){const logo=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><path d="M20 10H65V70H20ZM95 10H140V70H95ZM170 10H215V70H170Z" fill="black"/></svg>')).png().toBuffer(),f=new FormData();f.set('customerName','本机验收演示（合成素材）');f.set('productIds',JSON.stringify([product.id]));f.set('logo',new Blob([logo]),'qa-logo.png');task=await api('/api/tasks',f);}
 const logo=await api('/api/logo/'+task.id);if(!logo.productions.length)await api('/api/logo/'+task.id+'/productions',{sourceLogoAssetId:logo.sources[0].id,selectedElementIds:[logo.sources[0].elements[0].id],colorMode:'SINGLE',backgroundRemovalMode:'NONE',tolerance:20,primaryColor:'#000000',secondaryColor:'#c4a052',pantoneNote:'合成验收Logo',baseVersion:0});
 let page=await api('/api/automatic/'+task.id);if(!page.requirements.current){await api('/api/automatic/'+task.id+'/requirements',{baseVersion:0,requirementText:'本体黑Logo、彩盒白Logo；分别预览底色',processType:'NORMAL_PRINT',changeNote:'初始化验收首稿',structuredConfirmed:true,carrierOverrides:[{taskProductId:page.items[0].id,carrierId:'body',processType:'BLACK_PRINT',surfaceColor:'#b04020'},{taskProductId:page.items[0].id,carrierId:'carton',processType:'WHITE_PRINT',logoColor:'#ffffff',surfaceColor:'#304080'}]});page=await api('/api/automatic/'+task.id);}
 if(!page.outputs.length){const g=await api('/api/automatic/'+task.id+'/generate',{taskProductIds:page.items.map(i=>i.id),processType:'AUTO',requirementVersion:page.requirements.current.version});if(!g.outputs.length)throw Error('演示生成失败：'+JSON.stringify(g.runs[0]?.report));}return {taskId:task.id};
}
