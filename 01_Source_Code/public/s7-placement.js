import {autoPlace} from './auto-placement.js';
import {corners} from './mockup-geometry.js';
import {zonePoints,containsPolygon,polygonOverlap} from './zone-geometry.js';

const close=(a,b)=>Math.abs(a-b)<1e-6;
const samePlacement=(a,b)=>['x','y','widthRatio','rotation'].every(key=>close(a[key]||0,b[key]||0))&&JSON.stringify(a.quad)===JSON.stringify(b.quad);
const zoneFor=(target,template)=>template?.zones?.find(zone=>zone.zoneType==='logo'&&String(zone.id)===target.masterZoneId);

function defaultPlacement(zone,template,image,logo){
  const area=template.automation?.areas?.find(area=>area.zoneId!=null?String(area.zoneId)===String(zone.id):area.zoneRef?String(area.zoneRef)===String(zone.id):area.zoneIndex===template.zones.indexOf(zone));
  const preset=area?.presets?.find(preset=>preset.isDefault)||{orientation:'custom',box:{centerX:zone.defaultAnchorX??zone.x+zone.width/2,centerY:zone.defaultAnchorY??zone.y+zone.height/2,width:zone.width,height:zone.height,rotation:Number(zone.defaultRotation||0)+(zone.orientation==='vertical'?90:0)}};
  return autoPlace({...zone,maxLogoWidthRatio:1,maxLogoHeightRatio:1},preset,template.zones,image,logo);
}

export function constrainLogoPlacement(target,previous,template,image,logo){
  const zone=(!target.regionUnlocked&&zoneFor(target,template))||{x:0,y:0,width:1,height:1};
  const allowed=zonePoints(zone,image),points=value=>value.quad||corners(value,image,logo);
  const valid=value=>{const p=points(value);return p.every(p=>p.x>=-1e-9&&p.y>=-1e-9&&p.x<=1+1e-9&&p.y<=1+1e-9)&&containsPolygon(allowed,p)&&(target.regionUnlocked||!template?.zones?.some(z=>z.zoneType==='no-logo'&&polygonOverlap(p,zonePoints(z,image))));};
  if(valid(target))return target;
  if(previous&&!close(target.rotation||0,previous.rotation||0)){
    // Fit the requested angle by scaling the artwork, never by clipping the rotation itself.
    const center=target.quad?target.quad.reduce((sum,p)=>({x:sum.x+p.x/4,y:sum.y+p.y/4}),{x:0,y:0}):target;
    const scaled=scale=>({...target,widthRatio:target.widthRatio*scale,...(target.quad?{quad:target.quad.map(p=>({x:center.x+(p.x-center.x)*scale,y:center.y+(p.y-center.y)*scale}))}:{})});
    if(valid(scaled(0))){
      let lo=0,hi=1;
      for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(valid(scaled(mid)))lo=mid;else hi=mid;}
      return scaled(lo);
    }
  }
  if(zone.shapeType!=='POLYGON'){
    const angle=(zone.shapeType==='ROTATED_RECT'?zone.rotation||0:0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),cx=(zone.x+zone.width/2)*image.width,cy=(zone.y+zone.height/2)*image.height;
    const local=points(target).map(p=>({x:(p.x*image.width-cx)*c+(p.y*image.height-cy)*s,y:-(p.x*image.width-cx)*s+(p.y*image.height-cy)*c}));
    const left=Math.min(...local.map(p=>p.x)),right=Math.max(...local.map(p=>p.x)),top=Math.min(...local.map(p=>p.y)),bottom=Math.max(...local.map(p=>p.y)),w=zone.width*image.width,h=zone.height*image.height;
    if(right-left<=w+1e-7&&bottom-top<=h+1e-7){
      const dx=Math.min(w/2-right,Math.max(-w/2-left,0)),dy=Math.min(h/2-bottom,Math.max(-h/2-top,0));
      const x=(dx*c-dy*s)/image.width,y=(dx*s+dy*c)/image.height;
      const shifted={...target,x:target.x+x,y:target.y+y,...(target.quad?{quad:target.quad.map(p=>({x:p.x+x,y:p.y+y}))}:{})};
      if(valid(shifted))return shifted;
    }
  }
  let start=previous;
  if(!start||!valid(start)){
    if(!zoneFor(target,template))return previous||target;
    const point={...target,widthRatio:0,quad:undefined};
    start=!target.quad&&valid(point)?point:{...target,...defaultPlacement(zone,template,image,logo),quad:undefined};
  }
  const between=t=>({...target,...Object.fromEntries(['x','y','widthRatio','rotation'].map(key=>[key,(start[key]||0)+((target[key]||0)-(start[key]||0))*t])),...(target.quad&&start.quad?{quad:target.quad.map((p,i)=>({x:start.quad[i].x+(p.x-start.quad[i].x)*t,y:start.quad[i].y+(p.y-start.quad[i].y)*t}))}:{quad:undefined})});
  let lo=0,hi=1;
  for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(valid(between(mid)))lo=mid;else hi=mid;}
  return between(lo);
}

export function fitDefaultPlacements(state,template,image,logo,previousState=state){
  if(!state||!template?.zones?.length||!image?.width||!image?.height||!logo?.width||!logo?.height)return state;
  const aspect=logo.height/logo.width,previousAspect=state.placementLogoAspect;
  const update=(target,previous)=>{
    const zone=zoneFor(target,template);if(!zone||target.regionUnlocked)return constrainLogoPlacement(target,previous,template,image,logo);
    let next=target;
    if(previousAspect!==aspect){
      const raw={x:zone.defaultAnchorX??zone.x+zone.width/2,y:zone.defaultAnchorY??zone.y+zone.height/2,widthRatio:zone.width,rotation:target.rotation,quad:target.quad};
      const prior=previousAspect?{...defaultPlacement(zone,template,image,{width:1,height:previousAspect}),quad:undefined}:raw;
      if(samePlacement(target,prior))next={...target,...defaultPlacement(zone,template,image,logo),quad:undefined};
    }
    return constrainLogoPlacement(next,previous,template,image,logo);
  };
  const map=(targets,previous)=>targets?.map(target=>update(target,previous?.find(p=>p.id===target.id)));
  return {...state,placementLogoAspect:aspect,sharedTargets:map(state.sharedTargets,previousState.sharedTargets),schemes:state.schemes.map(scheme=>({...scheme,targets:map(scheme.targets,previousState.schemes.find(s=>s.version===scheme.version)?.targets)}))};
}
