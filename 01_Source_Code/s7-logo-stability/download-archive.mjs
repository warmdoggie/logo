// ZIP creation runs on the user's device so image downloads can use private OSS redirects.
export async function fetchArchive(files,{request=(...args)=>fetch(...args)}={}){
 if(!Array.isArray(files)||!files.length||files.length>200)throw Error('请选择 1–200 张图片');
 const controller=new AbortController(),result=new Array(files.length);let next=0,total=0;
 const limit=300*1024*1024,tooLarge=()=>Error('本次下载超过 300 MB，请分批选择');
 async function read(){
  while(next<files.length){
   const index=next++,file=files[index],response=await request(file.url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});
   if(!response.ok)throw Error('图片读取失败，请重试');
   if(Number(response.headers.get('content-length'))>limit-total)throw tooLarge();
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;size+=value.length;if(total>limit)throw tooLarge();chunks.push(value);}}
   finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   result[index]={name:file.name,bytes};
  }
 }
 try{await Promise.all([read(),read()]);return zipStore(result);}catch(error){controller.abort();throw error;}
}
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
export function zipStore(files){
 if(files.length>200)throw Error('每次最多下载 200 张');
 const parts=[],directory=[];let offset=0,total=0;
 for(const file of files){
  const name=new TextEncoder().encode(file.name),body=file.bytes;total+=body.length;
  if(total>300*1024*1024)throw Error('本次下载超过 300 MB，请分批选择');
  const crc=crc32(body),local=new Uint8Array(30),l=new DataView(local.buffer);
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,0x21,true);l.setUint32(14,crc,true);l.setUint32(18,body.length,true);l.setUint32(22,body.length,true);l.setUint16(26,name.length,true);
  parts.push(local,name,body);
  const central=new Uint8Array(46),c=new DataView(central.buffer);
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,0x21,true);c.setUint32(16,crc,true);c.setUint32(20,body.length,true);c.setUint32(24,body.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
  directory.push(central,name);offset+=local.length+name.length+body.length;
 }
 const directorySize=directory.reduce((sum,part)=>sum+part.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
 e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,directorySize,true);e.setUint32(16,offset,true);
 const bytes=new Uint8Array(offset+directorySize+end.length);let cursor=0;
 for(const part of [...parts,...directory,end]){bytes.set(part,cursor);cursor+=part.length;}
 return bytes;
}
