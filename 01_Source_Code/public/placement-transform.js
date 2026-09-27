export function transformPlacement(box,before,after,image){
 const W=image.width,H=image.height,oldAngle=(before.rotation||0)*Math.PI/180,newAngle=(after.rotation||0)*Math.PI/180;
 const oldX=(before.x+before.width/2)*W,oldY=(before.y+before.height/2)*H;
 const dx=box.centerX*W-oldX,dy=box.centerY*H-oldY;
 const x=(dx*Math.cos(oldAngle)+dy*Math.sin(oldAngle))*after.width/before.width;
 const y=(-dx*Math.sin(oldAngle)+dy*Math.cos(oldAngle))*after.height/before.height;
 const rotation=((box.rotation+(after.rotation||0)-(before.rotation||0)+180)%360+360)%360-180;
 return {...box,centerX:((after.x+after.width/2)*W+x*Math.cos(newAngle)-y*Math.sin(newAngle))/W,centerY:((after.y+after.height/2)*H+x*Math.sin(newAngle)+y*Math.cos(newAngle))/H,width:box.width*after.width/before.width,height:box.height*after.height/before.height,rotation};
}
