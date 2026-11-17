import {zonePoints,containsPolygon,polygonOverlap} from './zone-geometry.js';
// Shared normalized geometry; rotations are calculated in product pixel space.
export function lockedRotation(zone){return zone.orientation==='horizontal'?0:zone.orientation==='vertical'?90:zone.defaultRotation||0;}
export function maxWidth(zone,image,logo,rotation){const a=rotation*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a)),aspect=logo.height/logo.width;
 return Math.min(zone.maxLogoWidthRatio,zone.maxLogoHeightRatio*image.height/(image.width*aspect),zone.width/(c+aspect*s),zone.height*image.height/(image.width*(s+aspect*c)));}
export function placement(zone,image,logo){const rotation=lockedRotation(zone);return {x:zone.defaultAnchorX,y:zone.defaultAnchorY,widthRatio:fitWidth({x:zone.defaultAnchorX,y:zone.defaultAnchorY,rotation,widthRatio:maxWidth(zone,image,logo,rotation)*.8},zone,image,logo),rotation};}
export function fitWidth(p,zone,image,logo){let hi=p.widthRatio,lo=0;const poly=zonePoints(zone,image);for(let i=0;i<45;i++){const mid=(lo+hi)/2;if(containsPolygon(poly,corners({...p,widthRatio:mid},image,logo)))lo=mid;else hi=mid;}return lo;}
export function corners(p,image,logo){const w=p.widthRatio*image.width,h=w*logo.height/logo.width,a=p.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);const b=logo.contentBounds,scale=w/logo.width,left=b?(b.x-logo.width/2)*scale:-w/2,top=b?(b.y-logo.height/2)*scale:-h/2,right=b?left+b.width*scale:w/2,bottom=b?top+b.height*scale:h/2;return [[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>({x:p.x+(x*c-y*s)/image.width,y:p.y+(x*s+y*c)/image.height}));}
export function overlaps(a,b){for(const poly of [a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],axis={x:-(q.y-p.y),y:q.x-p.x},project=v=>v.map(p=>p.x*axis.x+p.y*axis.y),pa=project(a),pb=project(b);if(Math.max(...pa)<=Math.min(...pb)+1e-9||Math.max(...pb)<=Math.min(...pa)+1e-9)return false;}return true;}
export function validatePlacement(p,zone,zones,image,logo){const errors=[];if(!zone)return ['请选择 Logo 区域'];if(!p||!['x','y','widthRatio','rotation'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])))return ['位置、尺寸和角度必须是有效数字'];if(p.widthRatio<=0||p.widthRatio>1||Math.abs(p.rotation)>180)return ['尺寸或角度无效'];
 const pts=corners(p,image,logo),inside=(q,z)=>q.x>=z.x-1e-7&&q.y>=z.y-1e-7&&q.x<=z.x+z.width+1e-7&&q.y<=z.y+z.height+1e-7;
 if(!containsPolygon(zonePoints(zone,image),pts))errors.push('Logo 超出允许区域，请调整大小或位置');
 if(p.widthRatio>zone.maxLogoWidthRatio+1e-7||p.widthRatio*image.width*logo.height/logo.width/image.height>zone.maxLogoHeightRatio+1e-7)errors.push('Logo 超过母版尺寸上限');
 if((!zone.allowRotation||zone.orientation!=='free')&&Math.abs(p.rotation-lockedRotation(zone))>1e-7)errors.push('当前母版不允许此旋转方向');
 for(const z of zones.filter(z=>z.zoneType==='no-logo'))if(polygonOverlap(pts,zonePoints(z,image)))errors.push('Logo 与禁止区域「'+z.name+'」发生冲突，请调整位置');
 return errors;
}
