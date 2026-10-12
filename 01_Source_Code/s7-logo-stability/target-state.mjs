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

export function rotateTargetInPlace(target,degrees=90){
  if(Array.isArray(target.quad)&&target.quad.length===4){
    const center=target.quad.reduce((sum,point)=>({x:sum.x+point.x/4,y:sum.y+point.y/4}),{x:0,y:0});
    const radians=degrees*Math.PI/180;
    target.quad=target.quad.map(point=>{
      const x=point.x-center.x,y=point.y-center.y;
      return {
        x:Number(clamp(center.x+x*Math.cos(radians)-y*Math.sin(radians),0,1).toFixed(4)),
        y:Number(clamp(center.y+x*Math.sin(radians)+y*Math.cos(radians),0,1).toFixed(4))
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
