const signature=a=>a.mode==='SOLID'?'SOLID:'+a.hex.toLowerCase():a.mode==='FOIL'?'FOIL:'+a.foil:a.mode;
export function effectGroup(output,scope='PRODUCT'){
 const all=output.snapshot.targets,body=all.filter(t=>t.carrierType!=='CARTON');
 const targets=scope==='CARTON'?all.filter(t=>t.carrierType==='CARTON'):body.length?body:all;
 if(!targets.length)return null;
 const a=targets.map(t=>t.appearance||output.snapshot.appearance),same=a.every(v=>signature(v)===signature(a[0]));
 if(!same)return 'MIXED';
 if(a[0].mode==='ORIGINAL')return 'ORIGINAL';
 if(a[0].mode==='SOLID')return ['#000000','#ffffff'].includes(a[0].hex.toLowerCase())?'INK':'MIXED';
 return a[0].mode==='FOIL'?a[0].foil:'MIXED';
}
export function matchesOutput(output,group,{scope='PRODUCT',process=null}={}){
 if(output.unavailableReason)return false;
 const g=effectGroup(output,scope);if(!g)return false;
 const effect=group==='ALL'||g===group||group==='FOIL'&&['GOLD','SILVER','ROSE_GOLD','HOLOGRAPHIC'].includes(g);
 if(!effect||!process)return effect;
 const targets=output.snapshot.targets.filter(t=>scope==='CARTON'?t.carrierType==='CARTON':t.carrierType!=='CARTON');
 return targets.some(t=>t.processType===process);
}
export function selectionState(outputs,selected,group,filter){const ids=outputs.filter(o=>matchesOutput(o,group,filter)).map(o=>o.id),count=ids.filter(id=>selected.has(id)).length;return {ids,checked:ids.length>0&&count===ids.length,indeterminate:count>0&&count<ids.length};}
