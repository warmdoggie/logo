export function pointerToNormalized(clientX,clientY,rect){
  if(!rect||rect.width<=0||rect.height<=0)throw Error('画布尺寸无效');
  return {x:Math.max(0,Math.min(1,(clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(clientY-rect.top)/rect.height))};
}
