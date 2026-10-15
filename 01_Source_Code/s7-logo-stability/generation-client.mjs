export function createGenerationWatcher({request,onChange,onError,interval=2000}){
 let timer,stopped=false;
 function schedule(){clearTimeout(timer);if(!stopped)timer=setTimeout(()=>refresh().catch(()=>{}),interval);}
 function track(record){clearTimeout(timer);if(stopped||!record)return;onChange(record);if(record.status==='running')schedule();}
 async function refresh(){if(stopped)return;try{const record=await request();track(record);return record;}catch(error){if(!stopped){onError(error);if(error.status!==401&&error.status!==404)schedule();}throw error;}}
 return {refresh,track,stop(){stopped=true;clearTimeout(timer);}};
}
