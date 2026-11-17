function clamp(value,min,max){return Math.min(max,Math.max(min,value));}

function rotatedHalfExtents(widthRatio,aspectRatio,rotation){
  const radians=rotation*Math.PI/180,halfWidth=widthRatio/2,halfHeight=widthRatio*aspectRatio/2;
  return {
    x:Math.abs(Math.cos(radians))*halfWidth+Math.abs(Math.sin(radians))*halfHeight,
    y:Math.abs(Math.sin(radians))*halfWidth+Math.abs(Math.cos(radians))*halfHeight
  };
}

function normalizeRotation(rotation){
  const normalized=((rotation+180)%360+360)%360-180;
  return normalized===-0?0:normalized;
}

export function canMoveTarget(target){
  return target?.masterLocked!==true||target.moveEnabled===true;
}

export function setTargetMoveEnabled(target,enabled){
  target.moveEnabled=Boolean(enabled);
  return target;
}

export function rotateTargetInPlace(target,degrees=90,imageAspect=1){
  if(Array.isArray(target.quad)&&target.quad.length===4){
    const center=target.quad.reduce((sum,point)=>({x:sum.x+point.x/4,y:sum.y+point.y/4}),{x:0,y:0});
    const radians=degrees*Math.PI/180;
    target.quad=target.quad.map(point=>{
      const x=point.x-center.x,y=point.y-center.y;
      return {
        x:Number((center.x+x*Math.cos(radians)-y*Math.sin(radians)/imageAspect).toFixed(6)),
        y:Number((center.y+x*Math.sin(radians)*imageAspect+y*Math.cos(radians)).toFixed(6))
      };
    });
  }
  target.rotation=normalizeRotation((target.rotation??0)+degrees);
  return target;
}

export function cloneTarget(target,existingIds,offset=.06,logoAspectRatio=1){
  const ids=new Set(existingIds);
  const base=`${target.id}-copy`;
  let id=base;
  let suffix=2;
  while(ids.has(id))id=`${base}-${suffix++}`;
  const aspectRatio=Number.isFinite(logoAspectRatio)&&logoAspectRatio>0?logoAspectRatio:1;
  const extents=rotatedHalfExtents(target.widthRatio,aspectRatio,target.rotation??0);
  const halfWidth=Math.min(.49,Math.max(.01,extents.x));
  const halfHeight=Math.min(.49,Math.max(.01,extents.y));
  const quad=Array.isArray(target.quad)?target.quad.map(corner=>({
    x:Number(clamp(corner.x+offset,0,1).toFixed(4)),
    y:Number(clamp(corner.y+offset,0,1).toFixed(4))
  })):undefined;
  return {
    ...target,
    id,
    x:clamp(target.x+offset,halfWidth,1-halfWidth),
    y:clamp(target.y+offset,halfHeight,1-halfHeight),
    ...(quad?{quad}:{})
  };
}

const placementKeys=['x','y','widthRatio','rotation','quad','surface','curve'];
const placements=targets=>targets.map(target=>({id:target.id,...Object.fromEntries(placementKeys.filter(key=>Object.hasOwn(target,key)).map(key=>[key,structuredClone(target[key])]))}));
const placementSnapshot=state=>({sharedTargets:placements(state.sharedTargets),schemes:state.schemes.map(scheme=>({version:scheme.version,independentGeometry:scheme.independentGeometry,targets:placements(scheme.targets)}))});

export function createPlacementHistory(){
  let context,entries=[];
  function select(next){if(context!==next){context=next;entries=[];}}
  function restore(targets,saved){
    for(const target of targets){
      const placement=saved.find(item=>item.id===target.id);
      if(!placement)continue;
      for(const key of placementKeys){
        if(Object.hasOwn(placement,key))target[key]=structuredClone(placement[key]);
        else delete target[key];
      }
    }
  }
  return {
    canUndo(next){select(next);return entries.length>0;},
    record(next,before,after){
      select(next);const previous=placementSnapshot(before);
      if(JSON.stringify(previous)===JSON.stringify(placementSnapshot(after)))return;
      entries.push(previous);if(entries.length>3)entries.shift();
    },
    undo(next,state){
      select(next);const previous=entries.pop();if(!previous)return null;
      const restored=structuredClone(state);
      restore(restored.sharedTargets,previous.sharedTargets);
      for(const scheme of restored.schemes){
        const saved=previous.schemes.find(item=>item.version===scheme.version);
        if(saved){restore(scheme.targets,saved.targets);scheme.independentGeometry=saved.independentGeometry;}
        else if(!scheme.independentGeometry)restore(scheme.targets,previous.sharedTargets);
      }
      return restored;
    }
  };
}
