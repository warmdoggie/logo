export function buildTransparentLogoDataUrl(data){
  if(typeof data!=='string'||!data.trim())throw Error('没有可保存的透明 Logo');
  return data.startsWith('data:')?data:`data:image/png;base64,${data}`;
}

export function triggerTransparentLogoDownload(data,{documentRef=globalThis.document,filename='logo-transparent.png'}={}){
  const link=documentRef.createElement('a');
  link.href=buildTransparentLogoDataUrl(data);
  link.download=filename;
  link.click();
}
