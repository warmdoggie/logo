import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountTemplateAutomation} from './public/template-automation-ui.js';

function editor(run,readonly=false,unclassified=false,configure=()=>{}){
 const previous=globalThis.document,listeners=new Map(),controls=new Map(),errors=[],elements=[];let dirtyCalls=0,zoneDeleted=false;
 const element=()=>{const e={append(){},replaceChildren(){},querySelector:selector=>({addEventListener:(type,fn)=>controls.set(selector+':'+type,fn)}),querySelectorAll(){return [];}};elements.push(e);return e;};
 globalThis.document={createElement:element,createElementNS:element};
 const zone={id:'zone',zoneType:'logo',x:.1,y:.1,width:.8,height:.8},zones=[zone];let selected=zone.id;
 const initial={version:1,carriers:[{id:'body',type:'BODY',name:'产品'}],areas:[{id:'area',zoneIndex:0,carrierId:'body',name:'区域',autoEligible:false,presets:[{id:'preset',name:'默认摆放',isDefault:true,orientation:'horizontal',box:{centerX:.5,centerY:.5,width:.4,height:.4,rotation:0}}]}],schemes:[]};
 if(unclassified){zone.name='彩盒正面';initial.carriers=[];initial.areas=[];zone.defaultAnchorX=.5;zone.defaultAnchorY=.5;}
 configure(initial,zone,zones);
 const canvas={classList:{toggle(){}},append(){},setAttribute(){},focus(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:500}),addEventListener:(type,fn)=>listeners.set(type,fn)};
 try{
  const ui=mountTemplateAutomation({main:{querySelector:element,addEventListener:(type,fn)=>listeners.set(type,fn)},canvas,readonly,zones:()=>zoneDeleted?[]:zones,selected:()=>zoneDeleted?null:selected,image:()=>({width:1000,height:500}),selectMode(){},deleteZone(){ui.removeZone(zone.id);zoneDeleted=true;dirtyCalls++;ui.render();},refresh:()=>ui.render(),dirty(){dirtyCalls++;},reject:e=>errors.push(e)},initial);
  ui.render();
  const event=(x,y,placement,placementId)=>({clientX:x,clientY:y,button:0,pointerId:1,target:{dataset:{placement,placementId}},stopImmediatePropagation(){},preventDefault(){}});
  run({ui,errors,selectZone(id){selected=id;ui.render();},html:()=>elements[0].innerHTML,frameHtml:()=>elements[2].innerHTML,dirtyCount:()=>dirtyCalls,key:(key,options={})=>listeners.get('keydown')({key,target:canvas,preventDefault(){},...options}),control:(selector,type,event)=>{const fn=controls.get(selector+':'+type);assert.equal(typeof fn,'function','missing control '+selector);fn(event);},escape:()=>listeners.get('keydown')({key:'Escape',preventDefault(){}}),send:(type,x,y,placement,altKey=false,placementId='preset',shiftKey=false)=>listeners.get(type)({...event(x,y,placement,placementId),type,altKey,shiftKey})});
 }finally{globalThis.document=previous;}
}

test('one product foil checkbox enables all finishes and clears them together',()=>editor(({ui,control,dirtyCount,html})=>{
 const before=structuredClone(ui.serialize().areas[0]);
 assert.match(html(),/区域工艺/);
 assert.equal((html().match(/type="checkbox"/g)||[]).length,1);
 control('#area-foil','change',{target:{checked:true}});
 assert.deepEqual(ui.serialize().areas[0],{...before,foilProcesses:['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL']});
 control('#area-foil','change',{target:{checked:false}});
 assert.deepEqual(ui.serialize().areas[0],{...before,foilProcesses:[]});
 assert.equal(dirtyCount(),2);
}));

for(const count of [2,3])test('one foil checkbox updates all '+count+' product regions in the image',()=>editor(({ui,control,dirtyCount,selectZone,html})=>{
 const before=structuredClone(ui.serialize());
 control('#area-foil','change',{target:{checked:true}});
 const enabled=ui.serialize();
 for(const area of enabled.areas)assert.deepEqual(area.foilProcesses,['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL']);
 assert.deepEqual({...enabled,areas:enabled.areas.map((a,i)=>({...a,foilProcesses:before.areas[i].foilProcesses}))},before);
 assert.equal(dirtyCount(),1);
 selectZone('zone-1');assert.match(html(),/id="area-foil"\s+checked/);
 control('#area-foil','change',{target:{checked:false}});
 for(const area of ui.serialize().areas)assert.deepEqual(area.foilProcesses,[]);
 selectZone('zone');assert.doesNotMatch(html(),/id="area-foil"\s+checked/);
 assert.equal(dirtyCount(),2);
},false,false,(initial,zone,zones)=>{
 for(let i=1;i<count;i++){
  zones.push({...zone,id:'zone-'+i});
  initial.carriers.push({id:'carrier-'+i,type:i===1?'CAP':'OTHER',name:'包材 '+i});
  initial.areas.push({...structuredClone(initial.areas[0]),id:'area-'+i,zoneIndex:i,carrierId:'carrier-'+i});
 }
}));

test('image foil toggle includes unclassified product regions and preserves carton and forbidden regions',()=>editor(({ui,control,errors})=>{
 control('#area-foil','change',{target:{checked:true}});
 const config=ui.serialize();
 assert.deepEqual(errors,[]);
 assert.deepEqual(config.areas.map(a=>a.zoneIndex).sort(),[0,1,2]);
 for(const area of config.areas.filter(a=>a.zoneIndex!==1))assert.deepEqual(area.foilProcesses,['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL']);
 assert.deepEqual(config.areas.find(a=>a.zoneIndex===1).foilProcesses,['SILVER FOIL']);
 assert.equal(ui.carrierType('new-product'),'BODY');
 control('#area-foil','change',{target:{checked:false}});
 for(const area of ui.serialize().areas.filter(a=>a.zoneIndex!==1))assert.deepEqual(area.foilProcesses,[]);
 assert.deepEqual(ui.serialize().areas.find(a=>a.zoneIndex===1).foilProcesses,['SILVER FOIL']);
},false,false,(initial,zone,zones)=>{
 initial.carriers.push({id:'carton',type:'CARTON',name:'彩盒'});
 initial.areas.push({id:'carton-area',zoneIndex:1,carrierId:'carton',name:'彩盒',foilProcesses:['SILVER FOIL'],presets:[]});
 zones.push({...zone,id:'carton'},{...zone,id:'new-product',name:'产品包材'},{...zone,id:'legacy-carton',name:'彩盒正面'},{id:'forbidden',zoneType:'no-logo',x:0,y:0,width:.01,height:.01});
}));

test('failed image foil setup leaves every region unchanged',()=>editor(({ui,control,errors,dirtyCount})=>{
 const before=structuredClone(ui.serialize());
 control('#area-foil','change',{target:{checked:true}});
 assert.equal(errors.length,1);
 assert.deepEqual(ui.serialize(),before);
 assert.equal(dirtyCount(),0);
},false,false,(_initial,zone,zones)=>{zones.push({...zone,id:'too-narrow',width:.0001});}));

test('opening legacy partial foil permissions preserves them until the checkbox changes',()=>editor(({ui,control,dirtyCount,html})=>{
 assert.match(html(),/id="area-foil"\s+checked/);
 assert.deepEqual(ui.serialize().areas[0].foilProcesses,['ROSE GOLD FOIL']);
 assert.equal(dirtyCount(),0);
 control('#area-foil','change',{target:{checked:false}});
 assert.deepEqual(ui.serialize().areas[0].foilProcesses,[]);
 control('#area-foil','change',{target:{checked:true}});
 assert.deepEqual(ui.serialize().areas[0].foilProcesses,['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL']);
},false,false,initial=>{initial.areas[0].foilProcesses=['ROSE GOLD FOIL'];}));

test('legacy product foil selection creates a product area with valid placement data',()=>editor(({ui,control,dirtyCount})=>{
 control('#area-foil','change',{target:{checked:true}});
 const config=ui.serialize(),area=config.areas[0];
 assert.equal(config.carriers.find(c=>c.id===area.carrierId).type,'BODY');
 assert.deepEqual(area.foilProcesses,['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL']);
 assert.equal(area.presets.length,1);assert.equal(dirtyCount(),1);
},false,true,(_initial,zone)=>{zone.name='产品正面';}));

test('region type changes preserve placement identity and show carton advice',()=>editor(({ui,control,html})=>{
 const before=structuredClone(ui.serialize().areas[0]);
 control('#area-carrier-type','change',{target:{value:'CARTON'}});
 assert.equal(ui.carrierType('zone'),'CARTON');
 assert.match(html(),/彩盒不建议烫印，业务员知晓后可继续/);
 assert.equal((html().match(/type="checkbox"/g)||[]).length,0);
 control('#area-carrier-type','change',{target:{value:'BODY'}});
 const after=ui.serialize().areas[0];
 assert.equal(ui.carrierType('zone'),'BODY');
 assert.equal(after.id,before.id);assert.deepEqual(after.presets,before.presets);
 assert.deepEqual(after.foilProcesses,['ROSE GOLD FOIL']);
},false,false,initial=>{initial.areas[0].foilProcesses=['ROSE GOLD FOIL'];}));

test('legacy carton selection shows advice without permitting checkbox changes',()=>editor(({ui,html,dirtyCount})=>{
 assert.match(html(),/彩盒不建议烫印，业务员知晓后可继续/);
 assert.equal((html().match(/type="checkbox"/g)||[]).length,0);
 assert.deepEqual(ui.serialize().areas,[]);assert.equal(dirtyCount(),0);
},false,true));

test('read-only region controls cannot mutate permissions or classification',()=>editor(({ui,control,dirtyCount})=>{
 const before=structuredClone(ui.serialize());
 control('#area-foil','change',{target:{checked:true}});
 control('#area-carrier-type','change',{target:{value:'CARTON'}});
 assert.deepEqual(ui.serialize(),before);assert.equal(dirtyCount(),0);
},true));

for(const type of ['CAP','OTHER'])test('displaying '+type+' permissions retains its existing carrier classification',()=>editor(({ui,control})=>{
 assert.equal(ui.carrierType('zone'),type);
 control('#area-foil','change',{target:{checked:true}});
 assert.equal(ui.carrierType('zone'),type);
 assert.deepEqual(ui.serialize().areas[0].foilProcesses,['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL']);
},false,false,initial=>{initial.carriers[0].type=type;}));

for(const [corner,start,end,want] of [
 ['0',[300,150],[200,100],{centerX:.5,centerY:.5,width:.6,height:.6,rotation:0}],
 ['1',[700,150],[800,100],{centerX:.5,centerY:.5,width:.6,height:.6,rotation:0}],
 ['2',[700,350],[800,400],{centerX:.5,centerY:.5,width:.6,height:.6,rotation:0}],
 ['3',[300,350],[200,400],{centerX:.5,centerY:.5,width:.6,height:.6,rotation:0}]
])test('placement corner '+corner+' resizes symmetrically around the region center',()=>editor(({ui,send})=>{
 send('pointerdown',...start,corner);send('pointermove',...end,corner);send('pointerup',...end,corner);
 const actual=ui.serialize().areas[0].presets[0].box;
 for(const key of Object.keys(want))assert.ok(Math.abs(actual[key]-want[key])<1e-10,key);
}));

test('read-only placements cannot be resized',()=>editor(({ui,send})=>{
 send('pointerdown',300,150,'0');send('pointermove',200,100,'0');send('pointerup',200,100,'0');
 assert.deepEqual(ui.serialize().areas[0].presets[0].box,{centerX:.5,centerY:.5,width:.4,height:.4,rotation:0});
},true));

test('Alt clicks pass through the placement frame for switching overlapping regions',()=>editor(({ui,send})=>{
 const original=structuredClone(ui.serialize());
 send('pointerdown',300,150,'0',true);send('pointermove',200,100,'0');send('pointerup',200,100,'0');
 assert.deepEqual(ui.serialize(),original);
}));

test('each new position is retained, and direction changes only affect the selected frame',()=>editor(({ui,send,control})=>{
 const original=structuredClone(ui.serialize().areas[0].presets[0]);
 control('#add-placement','click');
 send('pointerdown',200,100);send('pointermove',600,350);send('pointerup',600,350);
 const area=ui.serialize().areas[0],preset=area.presets[1];
 assert.equal(area.presets.length,2);assert.equal(area.presets[0].id,'preset');
 assert.deepEqual(area.presets[0].box,original.box);
 assert.notEqual(preset.id,'preset');assert.equal(preset.isDefault,true);assert.equal(area.presets[0].isDefault,false);
 for(const [key,value]of Object.entries({centerX:.5,centerY:.5,width:.4,height:.5,rotation:0}))assert.ok(Math.abs(preset.box[key]-value)<1e-10,key);
 const box=structuredClone(preset.box);
 control('#auto-orientation','change',{target:{value:'vertical'}});
 assert.equal(ui.serialize().areas[0].presets[1].orientation,'vertical');
 assert.equal(ui.serialize().areas[0].presets[0].orientation,'horizontal');
 assert.deepEqual(ui.serialize().areas[0].presets[1].box,box);
 control('#add-placement','click');
 send('pointerdown',150,75);send('pointermove',250,125);send('pointerup',250,125);
 assert.equal(ui.serialize().areas[0].presets.length,3);
 assert.deepEqual(ui.serialize().areas[0].presets[1].box,box);
 send('pointerdown',650,325,'move');send('pointerup',650,325,'move');
 control('#auto-orientation','change',{target:{value:'vertical'}});
 assert.equal(ui.serialize().areas[0].presets[0].orientation,'vertical');
 assert.deepEqual(ui.serialize().areas[0].presets[0].box,original.box);
 assert.equal(ui.serialize().areas[0].presets.filter(p=>p.isDefault).length,1);
}));

test('overlapping positions can be selected independently with Shift click',()=>editor(({ui,send,control})=>{
 control('#add-placement','click');send('pointerdown',300,150);send('pointermove',700,350);send('pointerup',700,350);
 const newest=ui.serialize().areas[0].presets[1];
 send('pointerdown',500,250,'move',false,newest.id,true);
 control('#auto-orientation','change',{target:{value:'vertical'}});
 assert.equal(ui.serialize().areas[0].presets[0].orientation,'vertical');
 assert.equal(ui.serialize().areas[0].presets[1].orientation,'horizontal');
}));

test('resizing an inactive frame does not change any other saved position',()=>editor(({ui,send,control})=>{
 control('#add-placement','click');send('pointerdown',200,100);send('pointermove',600,350);send('pointerup',600,350);
 const second=structuredClone(ui.serialize().areas[0].presets[1]);
 send('pointerdown',300,150,'0');send('pointermove',200,100,'0');send('pointerup',200,100,'0');
 const [first,other]=ui.serialize().areas[0].presets;
 assert.equal(first.box.width,.6);assert.equal(first.box.height,.6);
 assert.deepEqual(other.box,second.box);assert.equal(other.orientation,second.orientation);
}));

test('choosing a direction while drawing does not change an existing frame',()=>editor(({ui,control,escape})=>{
 const original=structuredClone(ui.serialize());
 control('#add-placement','click');control('#auto-orientation','change',{target:{value:'vertical'}});
 assert.deepEqual(ui.serialize(),original);
 escape();assert.deepEqual(ui.serialize(),original);
}));

test('position count respects the existing ten-position limit',()=>editor(({ui,send,control})=>{
 for(let i=0;i<9;i++){control('#add-placement','click');send('pointerdown',200,100);send('pointermove',600,350);send('pointerup',600,350);}
 const original=structuredClone(ui.serialize());
 assert.equal(original.areas[0].presets.length,10);
 assert.equal(new Set(original.areas[0].presets.map(p=>p.id)).size,10);
 control('#add-placement','click');send('pointerdown',200,100);send('pointermove',600,350);send('pointerup',600,350);
 assert.deepEqual(ui.serialize(),original);
}));

test('invalid new positions and cancelled drawing preserve the previous position',()=>editor(({ui,send,control,escape,errors})=>{
 const original=structuredClone(ui.serialize());
 control('#add-placement','click');
 send('pointerdown',20,10);send('pointermove',980,490);send('pointerup',980,490);
 assert.equal(errors.length,1);assert.deepEqual(ui.serialize(),original);
 send('pointerdown',200,100);send('pointermove',600,350);escape();
 send('pointerup',600,350);
 assert.deepEqual(ui.serialize(),original);
}));

test('cancelling a new position on a legacy carton leaves its classification and draft untouched',()=>editor(({ui,control,escape,dirtyCount})=>{
 const original=structuredClone(ui.serialize());
 control('#add-placement','click');
 assert.equal(dirtyCount(),0);
 escape();
 assert.deepEqual(ui.serialize(),original);
},false,true));

test('unfinished positions cannot leak into drafts or published templates',()=>editor(({ui,control,escape})=>{
 const original=structuredClone(ui.serialize());
 control('#add-placement','click');
 assert.deepEqual(ui.serialize(),original);
 assert.throws(()=>ui.assertReady(),/框选/);
 escape();
 assert.doesNotThrow(()=>ui.assertReady());
 assert.deepEqual(ui.serialize(),original);
},false,true));

test('a completed legacy carton position preserves carton semantics',()=>editor(({ui,send,control})=>{
 control('#add-placement','click');send('pointerdown',200,100);send('pointermove',600,350);send('pointerup',600,350);
 const config=ui.serialize(),area=config.areas[0];
 assert.equal(config.carriers.find(c=>c.id===area.carrierId).type,'CARTON');
},false,true));

test('Backspace deletes only the clicked position and removes its scheme references',()=>editor(({ui,send,control,key})=>{
 control('#add-placement','click');send('pointerdown',200,100);send('pointermove',600,350);send('pointerup',600,350);
 const second=structuredClone(ui.serialize().areas[0].presets[1]);
 send('pointerdown',500,250,'move');send('pointerup',500,250,'move');key('Backspace');
 const config=ui.serialize();
 assert.equal(config.areas[0].presets.length,1);assert.equal(config.areas[0].presets[0].id,second.id);
 assert.deepEqual(config.areas[0].presets[0].box,second.box);assert.equal(config.areas[0].presets[0].isDefault,true);
 assert.deepEqual(config.schemes,[]);
},false,false,initial=>{initial.schemes=[{id:'scheme',name:'方案',role:'DEFAULT',targets:[{areaId:'area',presetId:'preset'}]}];}));

test('the last position can be deleted and redrawn without deleting the carrier area',()=>editor(({ui,send,control,key})=>{
 send('pointerdown',500,250,'move');send('pointerup',500,250,'move');key('Backspace');
 assert.equal(ui.serialize().areas[0].presets.length,0);assert.equal(ui.carrierType('zone'),'BODY');
 key('Backspace');assert.equal(ui.serialize().areas.length,1);
 control('#add-placement','click');send('pointerdown',200,100);send('pointermove',600,350);send('pointerup',600,350);
 assert.equal(ui.serialize().areas[0].presets.length,1);assert.equal(ui.serialize().areas[0].presets[0].isDefault,true);
}));

test('deleting a position keeps other scheme targets and promotes the remaining default scheme',()=>editor(({ui,send,key})=>{
 send('pointerdown',500,250,'move');send('pointerup',500,250,'move');key('Backspace');
 const config=ui.serialize();
 assert.deepEqual(config.schemes,[{id:'keep',name:'保留方案',role:'DEFAULT',targets:[{areaId:'area',presetId:'second'}]}]);
 assert.equal(config.areas[0].presets[0].id,'second');assert.equal(config.areas[0].presets[0].isDefault,true);
},false,false,initial=>{
 initial.areas[0].presets.push({...structuredClone(initial.areas[0].presets[0]),id:'second',isDefault:false});
 initial.schemes=[{id:'remove',name:'删除方案',role:'DEFAULT',targets:[{areaId:'area',presetId:'preset'}]},{id:'keep',name:'保留方案',role:'ALTERNATIVE',targets:[{areaId:'area',presetId:'second'}]}];
}));

for(const carton of [false,true])test('Backspace after clicking the '+(carton?'carton':'product')+' outer area deletes the area and its positions',()=>editor(({ui,send,key})=>{
 send('pointerdown',500,250,'move');send('pointerup',500,250,'move');
 send('pointerdown',120,60);send('pointerup',120,60);key('Backspace');
 assert.deepEqual(ui.serialize().areas,[]);assert.deepEqual(ui.serialize().schemes,[]);
},false,false,initial=>{if(carton)initial.carriers[0].type='CARTON';initial.schemes=[{id:'scheme',name:'方案',role:'DEFAULT',targets:[{areaId:'area',presetId:'preset'}]}];}));

test('Backspace in controls, read-only mode or an unfinished draw does not delete canvas data',()=>{
 for(const readonly of [false,true])editor(({ui,send,key,control,escape,dirtyCount})=>{
  send('pointerdown',500,250,'move');send('pointerup',500,250,'move');
  const original=structuredClone(ui.serialize()),dirty=dirtyCount();
  key('Backspace',{target:{tagName:'INPUT'}});key('Backspace',{target:{tagName:'TEXTAREA'}});key('Backspace',{target:{isContentEditable:true}});
  key('Backspace',{repeat:true});key('Backspace',{ctrlKey:true});key('Backspace',{isComposing:true});
  if(readonly)key('Backspace');
  else{control('#add-placement','click');key('Backspace');escape();}
  assert.deepEqual(ui.serialize(),original);assert.equal(dirtyCount(),dirty);
 },readonly);
});

for(const type of ['BODY','CARTON'])test(type+' placement uses the geometric region center rather than a legacy anchor',()=>editor(({ui,frameHtml,dirtyCount})=>{
 const box=ui.serialize().areas[0].presets[0].box;
 assert.equal(box.centerX,.5);assert.equal(box.centerY,.5);
 assert.match(frameHtml(),/<circle[^>]*data-placement-center[^>]*cx="500"[^>]*cy="250"/);
 assert.equal(dirtyCount(),1);
},false,false,(initial,zone)=>{
 initial.carriers[0].type=type;zone.defaultAnchorX=.3;zone.defaultAnchorY=.4;
 initial.areas[0].presets[0].box.centerX=.4;initial.areas[0].presets[0].box.centerY=.45;
}));

test('dragging the placement body selects it without separating the shared centers',()=>editor(({ui,send,dirtyCount})=>{
 const before=structuredClone(ui.serialize());
 send('pointerdown',500,250,'move');send('pointermove',550,275,'move');send('pointerup',550,275,'move');
 assert.deepEqual(ui.serialize(),before);assert.equal(dirtyCount(),0);
}));

test('a rotated placement resizes about its center in non-square image coordinates',()=>editor(({ui,send})=>{
 send('pointerdown',400,350,'2');send('pointermove',350,400,'2');send('pointerup',350,400,'2');
 const box=ui.serialize().areas[0].presets[0].box;
 assert.equal(box.centerX,.5);assert.equal(box.centerY,.5);
 assert.ok(Math.abs(box.width-.3)<1e-10);assert.ok(Math.abs(box.height-.6)<1e-10);
 assert.equal(box.rotation,90);
},false,false,initial=>{initial.areas[0].presets[0].box={centerX:.5,centerY:.5,width:.2,height:.4,rotation:90};}));

test('moving, scaling and rotating a region keeps placement centers shared',()=>editor(({ui})=>{
 assert.equal(ui.transformed('zone',{x:.1,y:.1,width:.8,height:.8,rotation:0},{x:.35,y:.3,width:.4,height:.6,rotation:30}),true);
 const box=ui.serialize().areas[0].presets[0].box;
 assert.equal(box.centerX,.55);assert.equal(box.centerY,.6);
 assert.equal(box.rotation,30);
}));

test('historical read-only placements retain their saved centers',()=>editor(({ui,dirtyCount})=>{
 assert.equal(ui.serialize().areas[0].presets[0].box.centerX,.4);assert.equal(dirtyCount(),0);
},true,false,initial=>{initial.areas[0].presets[0].box.centerX=.4;}));
