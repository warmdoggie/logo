import {foilVersions,foilNames} from './foil-finishes.mjs';
import {copyCustomColors} from './schemes.mjs';
import {isCarton} from './target-print.mjs';

const colorKeys=['color','autoContrast','preserveOriginalColor'];

function copyTargets(source,destination,masterTargets,options){
  const presetKeys=[...(options.size?['widthRatio']:[]),...(options.rotation?['rotation']:[]),...(options.color?colorKeys:[]),...(options.printFinish?['printFinish']:[])];
  const offsets=new Map();
  return destination.map(target=>{
    const carrier=target.carrierType||'BODY',index=offsets.get(carrier)||0;
    offsets.set(carrier,index+1);
    const preset=options.reference||source.filter(item=>(item.carrierType||'BODY')===carrier)[index];
    if(!preset)return structuredClone(target);
    if(options.keepPosition&&(!options.size||preset.widthRatio===target.widthRatio)&&(!options.rotation||preset.rotation===target.rotation))return structuredClone(target);
    const copied={...structuredClone(target),...Object.fromEntries(presetKeys.map(key=>[key,structuredClone(preset[key])]))};
    if(!options.size&&!options.rotation)return copied;
    const resetPosition=options.size&&options.rotation&&!options.keepPosition;
    const master=resetPosition?(masterTargets.find(item=>target.masterZoneId?item.masterZoneId===target.masterZoneId:item.id===target.id)||masterTargets.filter(item=>(item.carrierType||'BODY')===carrier)[index]||target):target;
    Object.assign(copied,{x:master.x,y:master.y,quad:undefined});
    if(master.quad){
      const scale=copied.widthRatio/master.widthRatio,center=master.quad.reduce((sum,point)=>({x:sum.x+point.x/4,y:sum.y+point.y/4}),{x:0,y:0}),angle=(copied.rotation-master.rotation)*Math.PI/180;
      const origin=resetPosition?master:center,aspect=options.keepPosition&&options.dimensions?options.dimensions.height/options.dimensions.width:1;
      copied.quad=master.quad.map(point=>{
        const x=(point.x-center.x)*scale,y=(point.y-center.y)*scale*aspect;
        return {x:Number((origin.x+x*Math.cos(angle)-y*Math.sin(angle)).toFixed(6)),y:Number((origin.y+(x*Math.sin(angle)+y*Math.cos(angle))/aspect).toFixed(6))};
      });
      if(copied.quad.some(point=>point.x<0||point.x>1||point.y<0||point.y>1))throw Error('Logo 尺寸或角度超出当前位置可容纳的范围，请调整后再应用');
    }
    if(options.dimensions&&!copied.quad){
      const {width,height,logoAspect}=options.dimensions,logoWidth=Math.max(1,Math.round(copied.widthRatio*width)),logoHeight=Math.max(1,Math.round(logoWidth*logoAspect)),angle=copied.rotation*Math.PI/180;
      const rotatedWidth=Math.round(Math.abs(Math.cos(angle))*logoWidth+Math.abs(Math.sin(angle))*logoHeight),rotatedHeight=Math.round(Math.abs(Math.sin(angle))*logoWidth+Math.abs(Math.cos(angle))*logoHeight);
      const left=Math.round(copied.x*width-rotatedWidth/2),top=Math.round(copied.y*height-rotatedHeight/2);
      if(left<0||top<0||left+rotatedWidth>width||top+rotatedHeight>height)throw Error('Logo 尺寸或角度超出当前位置可容纳的范围，请调整后再应用');
    }
    return copied;
  });
}

export const presetGroups=[
  {id:'carton',label:'彩盒',versions:[['ORIGINAL','原色搭配'],['BLACK','黑白搭配'],['CUSTOM','自定义配色']]},
  {id:'product',label:'产品',versions:[['ORIGINAL','原色搭配'],['BLACK','黑白搭配'],...foilVersions.map(version=>[version,foilNames[version]+'搭配']),['CUSTOM','自定义配色']]}
];
export const presetParameters={size:'大小',rotation:'角度',color:'颜色'};
export const presetScopeKeys=presetGroups.flatMap(group=>group.versions.flatMap(([version])=>(version==='CUSTOM'?['size','rotation','color']:['size','rotation']).map(parameter=>`${group.id}/${version}/${parameter}`)));

export function copyScopedPreset(source,destination,selection,dimensions,referenceTargetId){
  if(selection.some(key=>!presetScopeKeys.includes(key)))throw Error('同步范围包含不支持的设置');
  const copied=structuredClone(destination);
  for(const group of presetGroups){
    const matches=target=>isCarton(target)===(group.id==='carton');
    for(const [version] of group.versions){
      const options=Object.fromEntries(Object.keys(presetParameters).map(parameter=>[parameter,selection.includes(`${group.id}/${version}/${parameter}`)]));
      if(!Object.values(options).some(Boolean))continue;
      const preset=source.schemes.find(scheme=>scheme.version===version);
      const versions=group.id==='carton'&&version==='ORIGINAL'?['ORIGINAL',...foilVersions]:[version];
      const targets=preset.targets.filter(matches);
      if(!targets.length)continue;
      const reference=group.id==='product'?(targets.find(target=>target.id===referenceTargetId)||targets[0]):undefined;
      for(const scheme of copied.schemes.filter(scheme=>versions.includes(scheme.version))){
        if(!scheme.targets.some(matches))continue;
        if(options.size||options.rotation){
          const previous=scheme.targets.filter(matches),replacements=copyTargets(targets,previous,[],{...options,color:false,keepPosition:true,dimensions,reference});
          let index=0;
          scheme.targets=scheme.targets.map(target=>matches(target)?replacements[index++]:target);
          if(JSON.stringify(replacements)!==JSON.stringify(previous))scheme.independentGeometry=true;
        }
        if(options.color){
          const color=(reference||targets[0]).color;
          if(!/^#[0-9a-f]{6}$/i.test(color))throw Error('自定义颜色必须是 6 位十六进制颜色');
          scheme.targets=scheme.targets.map(target=>matches(target)?{...target,color,printFinish:'INK',autoContrast:false,preserveOriginalColor:false}:target);
        }
      }
    }
  }
  return copied;
}

export function copyProductPreset(source,destination,masterTargets,{size=true,color=true,printFinish=true,rotation=true,version}={}){
  if(!size&&!color&&!printFinish&&!rotation)return structuredClone(destination);
  const options={size,color,printFinish,rotation};
  const copied={...structuredClone(destination),sharedTargets:version?structuredClone(destination.sharedTargets):copyTargets(source.sharedTargets,destination.sharedTargets,masterTargets,options),schemes:destination.schemes.map(scheme=>{
    if(version&&scheme.version!==version)return structuredClone(scheme);
    const preset=source.schemes.find(item=>item.version===scheme.version);
    return {...structuredClone(scheme),independentGeometry:version&&(size||rotation)?true:size&&rotation?preset.independentGeometry:(size||rotation?scheme.independentGeometry||preset.independentGeometry:scheme.independentGeometry),targets:copyTargets(preset.targets,scheme.targets,masterTargets,options)};
  })};
  return version==='CUSTOM'&&color?copyCustomColors(source,copied):copied;
}
