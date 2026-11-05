const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const round=value=>Math.round(value*1e6)/1e6;
const normalizeAngle=value=>{const angle=((value+180)%360+360)%360-180;return round(angle);};

function zoneQuad(zone){
  if(zone.shapeType!=='POLYGON')return undefined;
  const points=Array.isArray(zone.points)?zone.points:(typeof zone.pointsJson==='string'?JSON.parse(zone.pointsJson):null);
  if(!Array.isArray(points)||points.length!==4)return undefined;
  return points.map(point=>({x:Number(point.x),y:Number(point.y)}));
}

export function masterTargetsFromTemplate(template){
  const zones=Array.isArray(template?.zones)?template.zones:[];
  return zones.filter(zone=>zone?.zoneType==='logo').map((zone,index)=>{
    const x=Number.isFinite(zone.defaultAnchorX)?zone.defaultAnchorX:zone.x+zone.width/2;
    const y=Number.isFinite(zone.defaultAnchorY)?zone.defaultAnchorY:zone.y+zone.height/2;
    const quad=zoneQuad(zone);
    const area=template.automation?.areas?.find(area=>area.zoneId!=null?String(area.zoneId)===String(zone.id):area.zoneIndex===zones.indexOf(zone));
    const preset=area?.presets?.find(preset=>preset.isDefault);
    const presetRotation=preset?.orientation==='vertical'?90:preset?.orientation==='horizontal'?0:undefined;
    const carrier=template.automation?.carriers?.find(carrier=>carrier.id===area?.carrierId);
    const faceName=`${zone.name||''} ${area?.name||''}`;
    const carton=carrier?carrier.type==='CARTON':/彩盒|纸盒|carton/i.test(faceName);
    return {
      id:`master-${zone.id||index+1}`,
      x:clamp(Number(x),0,1),
      y:clamp(Number(y),0,1),
      widthRatio:round(clamp(Number(zone.width),.01,1)),
      rotation:normalizeAngle(presetRotation??(Number(zone.defaultRotation||0)+(zone.orientation==='vertical'?90:0))),
      curve:0,
      surface:'free',
      ...(carton?{carrierType:/背|back/i.test(faceName)?'CARTON_BACK':'CARTON_FRONT',printFinish:'INK',preserveOriginalColor:true}:{}),
      ...(quad?{quad}:{}),
      masterZoneId:String(zone.id||index+1),
      masterLocked:true
    };
  });
}

export function rebindMasterZones(state,template){
 if(!template)return state;
 const previous=[...new Map((state.sharedTargets||state.schemes[0].targets).filter(target=>target.masterZoneId).map(target=>[target.masterZoneId,target])).values()],masters=masterTargetsFromTemplate(template),byId=new Map(masters.map(target=>[target.masterZoneId,target]));
 if(previous.every(target=>byId.has(target.masterZoneId)))return state;
 const fail=()=>{throw Error('母版区域数量或载体已改变，请重新选择产品并确认摆放');};
 if(previous.length!==masters.length)fail();
 const bindings=new Map(previous.filter(target=>byId.has(target.masterZoneId)).map(target=>[target.masterZoneId,byId.get(target.masterZoneId)])),used=new Set(bindings.keys()),missing=previous.filter(target=>!bindings.has(target.masterZoneId));
 for(const target of missing){
  const type=target.carrierType||'BODY',peers=missing.filter(item=>(item.carrierType||'BODY')===type),candidates=masters.filter(item=>!used.has(item.masterZoneId)&&(item.carrierType||'BODY')===type);
  if(peers.length!==1||candidates.length!==1)fail();
  bindings.set(target.masterZoneId,candidates[0]);used.add(candidates[0].masterZoneId);
 }
 const update=target=>{const master=bindings.get(target.masterZoneId);return master?{...target,masterZoneId:master.masterZoneId,carrierType:master.carrierType||'BODY'}:{...target};};
 return {...state,sharedTargets:state.sharedTargets?.map(update),schemes:state.schemes.map(scheme=>({...scheme,targets:scheme.targets.map(update)}))};
}
