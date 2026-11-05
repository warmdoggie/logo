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
 rose:['#8E554E','#F1C7B7','#C58F86','#8E554E'],
 laser:['#8BACE0','#D1A5D9','#E3C98A','#92CDBF','#A9BCE0']
};
export function laserFoilColor(position){
 const palette=foilPalettes.laser,scaled=Math.max(0,Math.min(1,position))*(palette.length-1),index=Math.min(palette.length-2,Math.floor(scaled)),mix=scaled-index;
 const rgb=hex=>[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16));
 const a=rgb(palette[index]),b=rgb(palette[index+1]);
 return {r:a[0]+(b[0]-a[0])*mix,g:a[1]+(b[1]-a[1])*mix,b:a[2]+(b[2]-a[2])*mix};
}
