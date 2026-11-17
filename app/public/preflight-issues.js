export function preflightIssueType(check){
 if(check.overallStatus==='BLOCK')return 'PROCESS_BLOCK';
 const hits=check.matchedRules.filter(h=>h.result!=='PASS');
 return hits.length&&hits.every(h=>/Logo|色数|渐变|半透明/i.test(h.message))?'LOGO_REVIEW':'REVIEW';
}
export function preflightIssuePresentation(issues){
 if(issues.every(i=>i.issueType==='LOGO_REVIEW'))return {title:'Logo 颜色信息待确认',message:'系统尚未可靠确认 Logo 的颜色、渐变或透明效果。请设计师核对 Logo 信息后重新做图。',review:true};
 if(issues.every(i=>i.issueType==='PROCESS_BLOCK'||/不支持|禁止.*工艺|工艺.*禁止/.test(i.reason)))return {title:'部分产品不支持所选工艺',message:'请更换适用工艺，或与设计师、印刷车间确认可行性。'};
 return {title:'部分效果需要处理',message:'请按下列原因补齐设置或调整方案，再重新做图。',review:issues.some(i=>i.issueType==='LOGO_REVIEW')};
}
