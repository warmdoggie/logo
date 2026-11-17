export const normalizeAngle=angle=>((angle+180)%360+360)%360-180;
export function axisAngle(preset,image){
 return normalizeAngle(preset.axisRotation??(preset.box.rotation+(preset.box.height*image.height>preset.box.width*image.width?90:0)));
}
// Keep both endpoints within the default placement box, even on non-square images.
export function axisEndpoints(preset,image){
 const b=preset.box,a=axisAngle(preset,image)*Math.PI/180,d=a-b.rotation*Math.PI/180;
 const half=.85*Math.min(b.width*image.width/2/Math.max(1e-12,Math.abs(Math.cos(d))),b.height*image.height/2/Math.max(1e-12,Math.abs(Math.sin(d))));
 return [-1,1].map(sign=>({x:b.centerX+sign*half*Math.cos(a)/image.width,y:b.centerY+sign*half*Math.sin(a)/image.height}));
}
export function carrierRemovalReason(config,id){
 const areas=config.areas.filter(a=>a.carrierId===id);
 if(areas.length)return '该载体仍有关联区域：'+areas.map(a=>a.name).join('、')+'。请先将区域转到其他载体，或移除方案引用后删除区域。';
 return null;
}
