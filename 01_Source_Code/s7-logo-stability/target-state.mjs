function clamp(value,min,max){return Math.min(max,Math.max(min,value));}

export function cloneTarget(target,existingIds,offset=.06){
  const ids=new Set(existingIds);
  const base=`${target.id}-copy`;
  let id=base;
  let suffix=2;
  while(ids.has(id))id=`${base}-${suffix++}`;
  const halfWidth=Math.min(.49,Math.max(.01,target.widthRatio/2));
  return {
    ...target,
    id,
    x:Number(clamp(target.x+offset,halfWidth,1-halfWidth).toFixed(4)),
    y:Number(clamp(target.y+offset,halfWidth,1-halfWidth).toFixed(4))
  };
}
