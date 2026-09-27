import {containsPolygon,zonePoints,polygonOverlap} from './zone-geometry.js';
import {corners} from './mockup-geometry.js';
// Geometry remains deterministic; no model chooses size, direction or position.
export function autoPlace(zone,preset,zones,image,logo){
 const b=preset?.box;if(!b||!image.width||!image.height||!logo.width||!logo.height)throw Error('Designer Required：缺少已确认的摆放预设或图片尺寸');
 let rotation=preset.orientation==='horizontal'?0:preset.orientation==='vertical'?90:preset.orientation==='follow-body'?(zone.rotation||0):preset.orientation==='long-axis'?(preset.axisRotation??(b.rotation+(b.height*image.height>b.width*image.width?90:0))):b.rotation;
 rotation=((rotation+180)%360+360)%360-180;
 const angle=(rotation-b.rotation)*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle)),aspect=logo.height/logo.width;
 let width=Math.min(b.width*image.width/(c+aspect*s),b.height*image.height/(s+aspect*c),zone.maxLogoWidthRatio*image.width,zone.maxLogoHeightRatio*image.height/aspect)/image.width;
 const p={x:b.centerX,y:b.centerY,widthRatio:width,rotation};
 const allowed=zonePoints(zone,image),valid=v=>{const pts=corners(v,image,logo);return containsPolygon(allowed,pts)&&!zones.some(z=>z.zoneType==='no-logo'&&polygonOverlap(pts,zonePoints(z,image)));};
 if(!valid(p)){let lo=0,hi=width;for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(valid({...p,widthRatio:mid}))lo=mid;else hi=mid;}p.widthRatio=lo;}
 if(p.widthRatio*image.width<2||!valid(p))throw Error('Designer Required：默认位置无法容纳 Logo');
 return p;
}
