import {corners} from './mockup-geometry.js';
import {zonePoints,polygonOverlap} from './zone-geometry.js';
// Manual edits intentionally ignore the designer's blue box, size and direction.
// Image boundaries and forbidden print regions are still enforced on the server.
export function validateManualPlacement(p,zones,image,logo){
 if(!p||!['x','y','widthRatio','rotation'].every(k=>Number.isFinite(p[k]))||!image?.width||!image?.height||!logo?.width||!logo?.height)return ['Logo 位置、大小和角度无效'];
 if(p.widthRatio*image.width<2||Math.abs(p.rotation)>180)return ['Logo 不能缩为零，角度应在 -180° 到 180° 之间'];
 const pts=corners(p,image,logo),errors=[];
 if(pts.some(q=>q.x<-1e-8||q.y<-1e-8||q.x>1+1e-8||q.y>1+1e-8))errors.push('Logo 不能移出产品图片');
 for(const z of zones.filter(z=>z.zoneType==='no-logo'))if(polygonOverlap(pts,zonePoints(z,image)))errors.push('请避开禁止印刷区域「'+z.name+'」');
 return errors;
}
