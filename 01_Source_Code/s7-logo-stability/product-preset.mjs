const colorKeys=['color','printFinish','autoContrast','preserveOriginalColor'];

function copyTargets(source,destination,masterTargets,options){
  const presetKeys=[...(options.geometry?['widthRatio','rotation']:[]),...(options.color?colorKeys:[])];
  const offsets=new Map();
  return destination.map(target=>{
    const carrier=target.carrierType||'BODY',index=offsets.get(carrier)||0;
    offsets.set(carrier,index+1);
    const preset=source.filter(item=>(item.carrierType||'BODY')===carrier)[index];
    if(!preset)return structuredClone(target);
    const copied={...structuredClone(target),...Object.fromEntries(presetKeys.map(key=>[key,structuredClone(preset[key])]))};
    if(!options.geometry)return copied;
    const master=masterTargets.find(item=>target.masterZoneId?item.masterZoneId===target.masterZoneId:item.id===target.id)||masterTargets.filter(item=>(item.carrierType||'BODY')===carrier)[index]||target;
    Object.assign(copied,{x:master.x,y:master.y,quad:undefined});
    if(master.quad){
      const scale=preset.widthRatio/master.widthRatio,center=master.quad.reduce((sum,point)=>({x:sum.x+point.x/4,y:sum.y+point.y/4}),{x:0,y:0}),angle=(preset.rotation-master.rotation)*Math.PI/180;
      copied.quad=master.quad.map(point=>{
        const x=(point.x-center.x)*scale,y=(point.y-center.y)*scale;
        return {x:Number((master.x+x*Math.cos(angle)-y*Math.sin(angle)).toFixed(6)),y:Number((master.y+x*Math.sin(angle)+y*Math.cos(angle)).toFixed(6))};
      });
      if(copied.quad.some(point=>point.x<0||point.x>1||point.y<0||point.y>1))throw Error('Logo 尺寸超出母版位置可容纳的范围，请缩小后再应用');
    }
    return copied;
  });
}

export function copyProductPreset(source,destination,masterTargets,{geometry=true,color=true}={}){
  if(!geometry&&!color)return structuredClone(destination);
  const options={geometry,color};
  return {...structuredClone(destination),sharedTargets:copyTargets(source.sharedTargets,destination.sharedTargets,masterTargets,options),schemes:destination.schemes.map(scheme=>{
    const preset=source.schemes.find(item=>item.version===scheme.version);
    return {...structuredClone(scheme),independentGeometry:geometry?preset.independentGeometry:scheme.independentGeometry,targets:copyTargets(preset.targets,scheme.targets,masterTargets,options)};
  })};
}
