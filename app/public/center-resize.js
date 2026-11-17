// All values are normalized to the source image. Resize along local axes,
// keeping the geometric center fixed even when a boundary stops the gesture.
export function centeredDimensions(box,width=box.width,height=box.height){
 const centerX=box.centerX??box.x+box.width/2,centerY=box.centerY??box.y+box.height/2;
 return {...box,width,height,...('centerX' in box?{centerX,centerY}:{x:centerX-width/2,y:centerY-height/2})};
}
export function resizeCentered(box,handle,delta,image={width:1,height:1},min=.003,valid){
 const W=image.width,H=image.height,a=(box.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 const localX=delta.x*W*c+delta.y*H*s,localY=-delta.x*W*s+delta.y*H*c;
 const keys=['nw','ne','se','sw'],key=typeof handle==='number'?keys[handle]:handle;
 const sx=key.includes('w')?-1:key.includes('e')?1:0,sy=key.includes('n')?-1:key.includes('s')?1:0;
 const target=centeredDimensions(box,sx?Math.max(min,box.width+2*sx*localX/W):box.width,sy?Math.max(min,box.height+2*sy*localY/H):box.height);
 const inside=b=>{const cx=b.centerX??b.x+b.width/2,cy=b.centerY??b.y+b.height/2,rx=(Math.abs(b.width*W*c)+Math.abs(b.height*H*s))/2/W,ry=(Math.abs(b.width*W*s)+Math.abs(b.height*H*c))/2/H;return cx-rx>=-1e-9&&cy-ry>=-1e-9&&cx+rx<=1+1e-9&&cy+ry<=1+1e-9;};
 const accept=b=>inside(b)&&(!valid||valid(b));
 if(accept(target))return target;
 if(!accept(box))return {...box};
 let lo=0,hi=1;for(let i=0;i<40;i++){const t=(lo+hi)/2,b=centeredDimensions(box,box.width+(target.width-box.width)*t,box.height+(target.height-box.height)*t);if(accept(b))lo=t;else hi=t;}
 return centeredDimensions(box,box.width+(target.width-box.width)*lo,box.height+(target.height-box.height)*lo);
}
