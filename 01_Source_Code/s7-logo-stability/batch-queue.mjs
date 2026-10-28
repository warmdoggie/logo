export async function runBatches(items,run){
 let next=0;
 const worker=async()=>{while(next<items.length)await run(items[next++]);};
 const settled=await Promise.allSettled(Array.from({length:Math.min(2,items.length)},worker));
 const failed=settled.find(result=>result.status==='rejected');if(failed)throw failed.reason;
}
