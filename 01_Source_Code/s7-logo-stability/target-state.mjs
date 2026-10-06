function clamp(value,min,max){return Math.min(max,Math.max(min,value));}

function rotatedHalfExtents(widthRatio,aspectRatio,rotation){
  const radians=rotation*Math.PI/180,halfWidth=widthRatio/2,halfHeight=widthRatio*aspectRatio/2;
  return {
    x:Math.abs(Math.cos(radians))*halfWidth+Math.abs(Math.sin(radians))*halfHeight,
    y:Math.abs(Math.sin(radians))*halfWidth+Math.abs(Math.cos(radians))*halfHeight
  };
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
