import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from './demo-server.mjs';

let transfer;
try{transfer=await import('./logo-image-transfer.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
function surface(){
 assert.equal(typeof transfer?.bindLogoImageTransfer,'function','Logo 素材框需要接收粘贴与拖入图片');
 const handlers={},paste={},classes=new Set(),imports=[];let focused=false;
 const document={addEventListener:(name,handler)=>paste[name]=handler};
 const dropzone={ownerDocument:document,focus:()=>{focused=true;},addEventListener:(name,handler)=>handlers[name]=handler,classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)},contains:node=>node?.inside===true};
 transfer.bindLogoImageTransfer({dropzone,onFiles:async files=>imports.push(files)});
 return {handlers,paste,classes,imports,isFocused:()=>focused};
}
const image=(name,type='image/png')=>({name,type});
function event(data,target={closest:()=>null}){return {target,clipboardData:data,dataTransfer:data,preventDefault(){this.prevented=true;}};}

test('clicking the logo dropzone focuses it for the next paste without importing',async()=>{
 const {handlers,paste,imports,isFocused}=surface();
 handlers.click?.();assert.equal(isFocused(),true);assert.equal(imports.length,0);
 const file=image('copied.png');await paste.paste(event({files:[file]}));
 assert.deepEqual(imports,[[file]]);
});

test('pasting an external image imports the clipboard file once',async()=>{
 const {paste,imports}=surface(),file=image('image.png'),e=event({files:[file],items:[{kind:'file',type:'image/png',getAsFile:()=>file}]});
 await paste.paste(e);assert.equal(e.prevented,true);assert.equal(imports.length,1);assert.deepEqual(imports[0],[file]);
});

test('clipboard image items work when the browser has no files list',async()=>{
 const {paste,imports}=surface(),file=image('clipboard.png');
 await paste.paste(event({files:[],items:[{kind:'string',type:'text/html'},{kind:'file',type:'image/png',getAsFile:()=>file}]}));
 assert.deepEqual(imports,[[file]]);
});

test('pasting into editable fields and pasting ordinary text keep their normal behavior',async()=>{
 const {paste,imports}=surface(),data={files:[image('image.png')]},typing=event(data,{closest:()=>({tagName:'INPUT'})}),text=event({files:[],items:[{kind:'string',type:'text/plain'}]});
 await paste.paste(typing);await paste.paste(text);assert.equal(imports.length,0);assert.equal(typing.prevented,undefined);assert.equal(text.prevented,undefined);
});

test('image paste still imports when the file picker has keyboard focus',async()=>{
 const {paste,imports}=surface(),file=image('copied.png'),e=event({files:[file]},{closest:()=>({tagName:'INPUT',type:'file'})});
 await paste.paste(e);assert.deepEqual(imports,[[file]]);assert.equal(e.prevented,true);
});

test('dropping multiple images preserves their order and excludes non-image files',async()=>{
 const {handlers,classes,imports}=surface(),a=image('a.png'),b=image('b.webp','image/webp'),e=event({types:['Files'],files:[a,image('notes.txt','text/plain'),b]});
 handlers.dragover(e);assert.equal(e.prevented,true);assert.equal(e.dataTransfer.dropEffect,'copy');assert.ok(classes.has('drag-over'));
 await handlers.drop(e);assert.deepEqual(imports,[[a,b]]);assert.equal(classes.has('drag-over'),false);
});

test('dragging between children keeps the target highlighted and leaving clears it',()=>{
 const {handlers,classes}=surface();handlers.dragover(event({types:['Files']}));
 handlers.dragleave({relatedTarget:{inside:true}});assert.ok(classes.has('drag-over'));
 handlers.dragleave({relatedTarget:null});assert.equal(classes.has('drag-over'),false);
});

test('non-image drops are cancelled without navigating or importing a logo',async()=>{
 const {handlers,imports}=surface(),e=event({files:[image('notes.txt','text/plain')]});await handlers.drop(e);
 assert.equal(e.prevented,true);assert.equal(imports.length,0);
});

test('the browser can load the image transfer module from the application',async()=>{
 const server=createDemoServer({authenticate:null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/logo-image-transfer.mjs`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
