import {renderAcceptance} from './acceptance-ui.js';
const main=document.querySelector('#main');
const toast=m=>{const e=document.querySelector('#toast');e.textContent=m;e.hidden=false;setTimeout(()=>e.hidden=true,4000);};
renderAcceptance(main,{toast,isCurrent:()=>true});
