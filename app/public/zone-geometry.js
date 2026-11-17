// Coordinates are normalized; rotations use the source image's pixel aspect ratio.
const EPS=1e-9;
export const shapeType=z=>z.shapeType||'RECT';
export function zonePoints(z,image={width:1,height:1}){
 if(shapeType(z)==='POLYGON')return Array.isArray(z.points)?z.points:JSON.parse(z.pointsJson||'[]');
 const cx=z.x+z.width/2,cy=z.y+z.height/2,a=(shapeType(z)==='ROTATED_RECT'?z.rotation||0:0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>{const x=u*z.width*image.width/2,y=v*z.height*image.height/2;return {x:cx+(x*c-y*s)/image.width,y:cy+(x*s+y*c)/image.height};});
}
export const bounds=pts=>{const x=Math.min(...pts.map(p=>p.x)),y=Math.min(...pts.map(p=>p.y));return {x,y,width:Math.max(...pts.map(p=>p.x))-x,height:Math.max(...pts.map(p=>p.y))-y};};
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const onSegment=(p,a,b)=>Math.abs(cross(a,b,p))<EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS;
export function pointInside(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i];if(onSegment(p,a,b))return true;if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
function intersects(a,b,c,d){const opposite=(x,y)=>(x>EPS&&y< -EPS)||(x< -EPS&&y>EPS);return (opposite(cross(a,b,c),cross(a,b,d))&&opposite(cross(c,d,a),cross(c,d,b)))||onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b);}
export function polygonError(poly){if(!Array.isArray(poly)||poly.length<3||poly.length>100)return '多边形需要 3–100 个节点';if(poly.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>1||p.y>1))return '节点必须在图片 0–1 坐标内';let area=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if(Math.hypot(a.x-b.x,a.y-b.y)<1e-6)return '相邻节点不能重合';area+=a.x*b.y-b.x*a.y;for(let j=i+1;j<poly.length;j++){if(j===i+1||(i===0&&j===poly.length-1))continue;if(intersects(a,b,poly[j],poly[(j+1)%poly.length]))return '多边形边不能交叉或自相接触';}}return Math.abs(area)<1e-8?'多边形面积太小':'';}
export function containsPolygon(container,inner){
 if(!inner.every(p=>pointInside(p,container)))return false;
 // Checking vertices alone misses edges traversing a concave notch.
 for(let i=0;i<inner.length;i++){const a=inner[i],b=inner[(i+1)%inner.length],cuts=[0,1],rx=b.x-a.x,ry=b.y-a.y;for(let j=0;j<container.length;j++){const c=container[j],d=container[(j+1)%container.length],sx=d.x-c.x,sy=d.y-c.y,den=rx*sy-ry*sx;if(Math.abs(den)<EPS){for(const p of [c,d])if(onSegment(p,a,b))cuts.push(Math.abs(rx)>Math.abs(ry)?(p.x-a.x)/rx:(p.y-a.y)/ry);continue;}const t=((c.x-a.x)*sy-(c.y-a.y)*sx)/den,u=((c.x-a.x)*ry-(c.y-a.y)*rx)/den;if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);}cuts.sort((x,y)=>x-y);for(let k=1;k<cuts.length;k++){const t=(cuts[k-1]+cuts[k])/2;if(!pointInside({x:a.x+t*rx,y:a.y+t*ry},container))return false;}}
 return true;
}
function triangles(poly){const p=poly.map(v=>({...v})),out=[];let area=0;for(let i=0;i<p.length;i++)area+=p[i].x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*p[i].y;if(area<0)p.reverse();while(p.length>3){let found=false;for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length];if(Math.abs(cross(a,b,c))<EPS){p.splice(i,1);found=true;break;}if(cross(a,b,c)<=0)continue;if(p.some(v=>v!==a&&v!==b&&v!==c&&pointInside(v,[a,b,c])))continue;out.push([a,b,c]);p.splice(i,1);found=true;break;}if(!found)throw Error('多边形几何无效');}if(p.length===3)out.push(p);return out;}
function convexOverlap(a,b){for(const poly of [a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],axis={x:-(q.y-p.y),y:q.x-p.x},project=v=>v.map(p=>p.x*axis.x+p.y*axis.y),pa=project(a),pb=project(b);if(Math.max(...pa)<=Math.min(...pb)+EPS||Math.max(...pb)<=Math.min(...pa)+EPS)return false;}return true;}
export function polygonOverlap(a,b){return triangles(a).some(ta=>triangles(b).some(tb=>convexOverlap(ta,tb)));}
