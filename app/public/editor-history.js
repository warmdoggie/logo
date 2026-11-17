// Snapshots include all editor panels. Never keep live references in undo history.
export function editorHistory(initial, limit=100) {
 let entries=[structuredClone(initial)],index=0;
 return {
  get canUndo(){return index>0;}, get canRedo(){return index<entries.length-1;},
  push(value){
   if(JSON.stringify(entries[index])===JSON.stringify(value))return false;
   entries=entries.slice(0,index+1);entries.push(structuredClone(value));
   if(entries.length>limit+1)entries.shift();index=entries.length-1;return true;
  },
  undo(){if(index>0)index--;return structuredClone(entries[index]);},
  redo(){if(index<entries.length-1)index++;return structuredClone(entries[index]);},
  reset(value){entries=[structuredClone(value)];index=0;}
 };
}

export function confirmEditorAction(main,message){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','确认母版修改');
  const text=document.createElement('p');text.textContent=message;
  const cancel=document.createElement('button');cancel.type='button';cancel.className='btn';cancel.textContent='保留修改';
  const accept=document.createElement('button');accept.type='button';accept.className='btn primary';accept.textContent='确认执行';
  const finish=value=>{dialog.close();dialog.remove();resolve(value);};
  cancel.onclick=()=>finish(false);accept.onclick=()=>finish(true);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
  dialog.append(text,cancel,accept);main.append(dialog);dialog.showModal();cancel.focus();
 });
}
