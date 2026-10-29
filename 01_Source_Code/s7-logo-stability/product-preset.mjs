const colorKeys=['color','autoContrast','preserveOriginalColor'];

function copyTargets(source,destination,masterTargets,options){
  const presetKeys=[...(options.size?['widthRatio']:[]),...(options.rotation?['rotation']:[]),...(options.color?colorKeys:[]),...(options.printFinish?['printFinish']:[])];
  const offsets=new Map();
  return destination.map(target=>{
    const carrier=target.carrierType||'BODY',index=offsets.get(carrier)||0;
    offsets.set(carrier,index+1);
    const preset=source.filter(item=>(item.carrierType||'BODY')===carrier)[index];
    if(!preset)return structuredClone(target);
    const copied={...structuredClone(target),...Object.fromEntries(presetKeys.map(key=>[key,structuredClone(preset[key])]))};
    if(!options.size&&!options.rotation)return copied;
    const master=options.size&&options.rotation?(masterTargets.find(item=>target.masterZoneId?item.masterZoneId===target.masterZoneId:item.id===target.id)||masterTargets.filter(item=>(item.carrierType||'BODY')===carrier)[index]||target):target;
    Object.assign(copied,{x:master.x,y:master.y,quad:undefined});
    if(master.quad){
      const scale=copied.widthRatio/master.widthRatio,center=master.quad.reduce((sum,point)=>({x:sum.x+point.x/4,y:sum.y+point.y/4}),{x:0,y:0}),angle=(copied.rotation-master.rotation)*Math.PI/180;
      const origin=options.size&&options.rotation?master:center;
      copied.quad=master.quad.map(point=>{
        const x=(point.x-center.x)*scale,y=(point.y-center.y)*scale;
        return {x:Number((origin.x+x*Math.cos(angle)-y*Math.sin(angle)).toFixed(6)),y:Number((origin.y+x*Math.sin(angle)+y*Math.cos(angle)).toFixed(6))};
      });
      if(copied.quad.some(point=>point.x<0||point.x>1||point.y<0||point.y>1))throw Error('Logo 尺寸或角度超出当前位置可容纳的范围，请调整后再应用');
    }
    return copied;
  });
}

export function copyProductPreset(source,destination,masterTargets,{size=true,color=true,printFinish=true,rotation=true}={}){
  if(!size&&!color&&!printFinish&&!rotation)return structuredClone(destination);
  const options={size,color,printFinish,rotation};
  return {...structuredClone(destination),sharedTargets:copyTargets(source.sharedTargets,destination.sharedTargets,masterTargets,options),schemes:destination.schemes.map(scheme=>{
    const preset=source.schemes.find(item=>item.version===scheme.version);
    return {...structuredClone(scheme),independentGeometry:size&&rotation?preset.independentGeometry:(size||rotation?scheme.independentGeometry||preset.independentGeometry:scheme.independentGeometry),targets:copyTargets(preset.targets,scheme.targets,masterTargets,options)};
  })};
}
