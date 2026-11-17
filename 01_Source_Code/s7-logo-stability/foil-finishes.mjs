import {laserTexture,laserTextureWidth,laserTextureHeight} from './laser-foil-texture.mjs';
export const foilVersions=['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL'];
export const foilNames={'GOLD FOIL':'烫金','SILVER FOIL':'烫银','ROSE GOLD FOIL':'烫玫瑰金','LASER FOIL':'烫镭射'};
export const foilFinishes={
 'GOLD FOIL':{finish:'gold',color:'#C4A052'},
 'SILVER FOIL':{finish:'silver',color:'#BFC3C9'},
 'ROSE GOLD FOIL':{finish:'rose',color:'#C58F86'},
 'LASER FOIL':{finish:'laser',color:'#BFC3C9'}
};
export const foilPalettes={
 gold:['#92703B','#E9D397','#C4A052','#92703B'],
 silver:['#767C84','#E7EBEF','#BFC3C9','#767C84'],
 rose:['#8E554E','#F1C7B7','#C58F86','#8E554E']
};
export function foilBrightness(x,y,width,height,finish){
 const u=(x+.5)/width,v=(y+.5)/height,diagonal=u*.76+v*.24;
 const broad=Math.exp(-((diagonal-.53)**2)/.13);
 const glint=Math.exp(-((diagonal-.39)**2)/.012);
 return Math.min(1.24,Math.max(.72,.76+broad*.22+glint*.26))*(finish==='laser'?1.1:1);
}
export function laserFoilColor(u,v){
 const x=Math.max(0,Math.min(laserTextureWidth-1,u*laserTextureWidth-.5)),y=Math.max(0,Math.min(laserTextureHeight-1,v*laserTextureHeight-.5));
 const left=Math.floor(x),top=Math.floor(y),right=Math.min(laserTextureWidth-1,left+1),bottom=Math.min(laserTextureHeight-1,top+1),fx=x-left,fy=y-top;
 const channel=c=>laserTexture[(top*laserTextureWidth+left)*3+c]*(1-fx)*(1-fy)+laserTexture[(top*laserTextureWidth+right)*3+c]*fx*(1-fy)+laserTexture[(bottom*laserTextureWidth+left)*3+c]*(1-fx)*fy+laserTexture[(bottom*laserTextureWidth+right)*3+c]*fx*fy;
 // Silver foil carries a restrained rainbow reflection over its neutral metal base.
 const silver=c=>176+(channel(c)-176)*.42;
 return {r:silver(0),g:silver(1),b:silver(2)};
}
