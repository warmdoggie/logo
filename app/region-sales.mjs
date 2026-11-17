import {createHash} from 'node:crypto';
import {PRINT_METHODS,FOIL_EFFECTS} from './printing-settings.mjs';
import {regionPolicy} from './region-printing.mjs';
import {effectiveFoilTargets,foilTargetFor,usesFoil,ordinaryProcess} from './public/foil-targets.js';
const fail=message=>{throw Object.assign(Error(message),{status:400});};
export function normalizeAreaOverrides(value,allowedIds){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>100)fail('区域调整格式无效');
 return Object.fromEntries(Object.entries(value).map(([id,v])=>{
  if(!allowedIds.includes(id)||!v||typeof v!=='object')fail('调整区域不属于这张图片的锁定母版');
  const o={};if(v.process){if(!PRINT_METHODS[v.process])fail('区域工艺无效');o.process=v.process;}
  if(v.appearance){const a=v.appearance;if(a.mode==='ORIGINAL')o.appearance={mode:'ORIGINAL'};else if(a.mode==='SOLID'&&/^#[0-9a-f]{6}$/i.test(a.hex||''))o.appearance={mode:'SOLID',hex:a.hex.toLowerCase()};else if(a.mode==='FOIL'&&FOIL_EFFECTS[a.foil])o.appearance={mode:'FOIL',foil:a.foil};else fail('区域颜色无效');}
  if(v.placement){if(!['x','y','widthRatio','rotation'].every(k=>Number.isFinite(v.placement[k]))||v.placement.widthRatio<=0||Math.abs(v.placement.rotation)>180)fail('手动位置、尺寸或角度无效');o.placement=Object.fromEntries(['x','y','widthRatio','rotation'].map(k=>[k,v.placement[k]]));}
  if(v.cartonFoilConfirmed===true)o.cartonFoilConfirmed=true;
  return [id,o];
 }));
}
export function regionChoiceSignature(item,kind,draft){
 return createHash('sha256').update(JSON.stringify({templateId:item.templateId,kind,foil:kind==='FOIL'?draft.foil:null,overrides:draft.overrides?.[item.id+':'+kind]||{},...(kind==='FOIL'&&draft.foilTargets?{foilTargets:draft.foilTargets}:{})})).digest('hex');
}
export function regionChoices(plan,item,kind,draft){
 const overrides=draft.overrides?.[item.id+':'+kind]?.areas||{},choices=[];
 if(kind==='FOIL'&&!plan.targets.some(t=>effectiveFoilTargets(draft,plan.targets).includes(foilTargetFor(t))))fail('该母版没有所选的烫印区域，请更改烫印区域，或请设计师检查产品／彩盒归属');
 function choose(target,productAppearance){
  const s=target.area.printing,o=overrides[target.area.id]||{},carton=target.carrier?.type==='CARTON';
  if(!s)fail('请设计师补齐区域「'+target.area.name+'」的工艺设置');
  const foil=usesFoil(target,kind,draft,plan.targets),process=o.process||(foil?'HOT_STAMP':kind==='FOIL'?ordinaryProcess(s):s.defaultProcess);
  if(!process)fail('区域「'+target.area.name+'」没有可用的油墨工艺，请设计师补齐设置');
  let appearance=o.appearance;
  if(!appearance){if(foil)appearance={mode:'FOIL',foil:draft.foil};else if(carton)appearance=productAppearance?.mode==='FOIL'||!productAppearance?{mode:'AUTO_BW'}:productAppearance;else appearance=kind==='INK'?{mode:'SOLID',hex:s.ink==='WHITE'?'#ffffff':'#000000'}:{mode:'ORIGINAL'};}
  // A carton HOT_STAMP selection must always explicitly specify a foil color.
  if(process==='HOT_STAMP'&&appearance.mode!=='FOIL'||process!=='HOT_STAMP'&&appearance.mode==='FOIL')fail('区域「'+target.area.name+'」的工艺与颜色方案不一致，请选择烫印色或油墨色');
  if(appearance.mode==='FOIL'&&!FOIL_EFFECTS[appearance.foil])fail('请选择烫印颜色');
  const policy=regionPolicy(s,target.carrier,process);
  const color=appearance.mode==='SOLID'?appearance.hex:appearance.mode==='FOIL'?FOIL_EFFECTS[appearance.foil].hex:null;
  const choice={target,process,appearance,color,placement:o.placement||null,cartonFoilConfirmed:carton&&o.cartonFoilConfirmed===true,policy};choices.push(choice);return choice;
 }
 const products=plan.targets.filter(t=>t.carrier?.type!=='CARTON').map(t=>choose(t));
 const common=products.length&&products.every(p=>JSON.stringify(p.appearance)===JSON.stringify(products[0].appearance))?products[0].appearance:null;
 for(const target of plan.targets.filter(t=>t.carrier?.type==='CARTON'))choose(target,common||(products.length?{mode:'AUTO_BW'}:kind==='ORIGINAL'?{mode:'ORIGINAL'}:{mode:'AUTO_BW'}));
 const blocked=choices.filter(c=>['BLOCK','NEED_INFO'].includes(c.policy.status));
 if(blocked.length){
  const reason=blocked.map(c=>c.target.area.name+'：'+c.policy.message).join('；');
  const productFoilBlocked=blocked.every(c=>c.target.carrier?.type!=='CARTON'&&c.process==='HOT_STAMP'&&c.policy.status==='BLOCK');
  const productFallback=products.map(c=>({areaId:c.target.area.id,process:ordinaryProcess(c.target.area.printing),appearance:{mode:'ORIGINAL'}}));
  const cartonCanContinue=choices.some(c=>c.target.carrier?.type==='CARTON'&&c.process==='HOT_STAMP')&&productFallback.every(c=>!!c.process);
  throw Object.assign(Error(reason),{status:400,issueType:'PROCESS_BLOCK',...(productFoilBlocked&&cartonCanContinue?{detail:{type:'PRODUCT_FOIL_BLOCK',fallback:productFallback,areaNames:blocked.map(c=>c.target.area.name)}}:{})});
 }
 return choices;
}
