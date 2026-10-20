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
    const carrier=template.automation?.carriers?.find(carrier=>carrier.id===area?.carrierId);
    const faceName=`${zone.name||''} ${area?.name||''}`;
    const carton=carrier?.type==='CARTON'||/彩盒|纸盒|carton/i.test(faceName);
    return {
      id:`master-${zone.id||index+1}`,
      x:clamp(Number(x),0,1),
      y:clamp(Number(y),0,1),
      widthRatio:round(clamp(Number(zone.width),.01,1)),
      rotation:normalizeAngle(Number(zone.defaultRotation||0)+(zone.orientation==='vertical'?90:0)),
      curve:0,
      surface:'free',
      ...(carton?{carrierType:/背|back/i.test(faceName)?'CARTON_BACK':'CARTON_FRONT',printFinish:'INK',preserveOriginalColor:true}:{}),
      ...(quad?{quad}:{}),
      masterZoneId:String(zone.id||index+1),
      masterLocked:true
    };
  });
}
