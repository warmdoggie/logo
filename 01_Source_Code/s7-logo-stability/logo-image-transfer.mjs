export function visibleLogoBounds(data,width,height){
  let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  return right<0?null:{left,top,width:right-left+1,height:bottom-top+1};
}

export function bindLogoImageTransfer({dropzone,onFiles}){
  dropzone.addEventListener('click',()=>dropzone.focus());
  const images=data=>{
    const files=data?.files?.length?Array.from(data.files):Array.from(data?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
    return files.filter(file=>file.type?.startsWith('image/')||!file.type&&/\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name||''));
  };
  dropzone.ownerDocument.addEventListener('paste',event=>{
    const editable=event.target?.closest?.('input,textarea,[contenteditable]:not([contenteditable="false"])');
    if(event.defaultPrevented||editable&&!(editable.tagName==='INPUT'&&editable.type==='file'))return;
    const files=images(event.clipboardData);if(!files.length)return;
    event.preventDefault();return onFiles(files);
  });
  const dragover=event=>{
    if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
    event.preventDefault();event.dataTransfer.dropEffect='copy';dropzone.classList.add('drag-over');
  };
  dropzone.addEventListener('dragenter',dragover);
  dropzone.addEventListener('dragover',dragover);
  dropzone.addEventListener('dragleave',event=>{if(!dropzone.contains(event.relatedTarget))dropzone.classList.remove('drag-over');});
  dropzone.addEventListener('drop',event=>{
    event.preventDefault();dropzone.classList.remove('drag-over');
    const files=images(event.dataTransfer);if(files.length)return onFiles(files);
  });
}
