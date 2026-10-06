export function pointerToNormalized(clientX,clientY,rect){
  if(!rect||rect.width<=0||rect.height<=0)throw Error('画布尺寸无效');
  return {x:Math.max(0,Math.min(1,(clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(clientY-rect.top)/rect.height))};
}

export function rotationFromPointer(center,point){
  const degrees=Math.atan2(point.y-center.y,point.x-center.x)*180/Math.PI+90;
  return Number((((degrees+180)%360+360)%360-180).toFixed(4));
}

export function widthRatioFromScalePointer(target,point,canvasWidth,canvasHeight=canvasWidth){
  const radians=-(target.rotation||0)*Math.PI/180;
  const dx=point.x-target.x*canvasWidth,dy=point.y-target.y*canvasHeight;
  const localX=dx*Math.cos(radians)-dy*Math.sin(radians);
  return Math.max(.02,Math.min(.9,Number((Math.abs(localX)*2/canvasWidth).toFixed(4))));
}

export function clampTargetCenter(target,logoAspectRatio=1){
  if(!target||target.quad)return target;
  const widthRatio=Number(target.widthRatio),aspectRatio=Number(logoAspectRatio),rotation=Number(target.rotation||0);
  if(!Number.isFinite(widthRatio)||widthRatio<=0||!Number.isFinite(aspectRatio)||aspectRatio<=0)return target;
  const radians=rotation*Math.PI/180,halfWidth=widthRatio/2,halfHeight=widthRatio*aspectRatio/2;
  const extentX=Math.abs(Math.cos(radians))*halfWidth+Math.abs(Math.sin(radians))*halfHeight;
  const extentY=Math.abs(Math.sin(radians))*halfWidth+Math.abs(Math.cos(radians))*halfHeight;
  return {...target,x:Math.min(1-extentX,Math.max(extentX,target.x)),y:Math.min(1-extentY,Math.max(extentY,target.y))};
}
