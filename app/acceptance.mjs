import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

export function acceptanceService(root, db) {
  let run = {id:null,status:'IDLE',startedAt:null,finishedAt:null,passed:null,failed:null,log:'尚未运行验收。'};
  const phases = [
    {id:'S0',name:'迁移接续核验',status:'PASS',summary:'数据库、素材和启动基线已核对'},
    {id:'S1',name:'母版自动化与任务覆盖',status:'PASS',summary:'母版操作、长轴、撤销、权限、任务覆盖已通过本机自动及页面验收'},
    {id:'S2',name:'Logo、背景、颜色与参考图',status:'PASS',summary:'参考图取色、来源保存、HEX/RGB、区域改色与低对比提示已通过自动和页面验收'},
    {id:'S3',name:'区域级工艺规则',status:'PARTIAL',summary:'已有规则基础，区域覆盖及优先级仍待完善'},
    {id:'S4',name:'客户要求与修稿轮次',status:'PENDING',summary:'等待 S3 验收通过'},
    {id:'S5',name:'业务员与设计师权限',status:'PARTIAL',summary:'母版发布权限已补齐；业务与专业操作入口仍待整理'},
    {id:'S6',name:'效果图标准与导出',status:'PENDING',summary:'等待前置阶段完成'},
    {id:'S7',name:'AI 增强与 QA 闭环',status:'PENDING',summary:'真实 AI 接口保持关闭'},
    {id:'S8',name:'真实业务验收与发布冻结',status:'PENDING',summary:'全部阶段完成后执行'}
  ];
  function snapshot() {
    const count=(table)=>db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    return {database:{integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,products:count('Product'),tasks:count('Task'),templates:count('ProductTemplate'),zones:count('TemplateZone')},phases,run};
  }
  function start() {
    if(run.status==='RUNNING') return snapshot();
    run={id:randomUUID(),status:'RUNNING',startedAt:new Date().toISOString(),finishedAt:null,passed:null,failed:null,log:'验收正在运行，请稍候。'};
    const child=spawn(process.execPath,['run-tests.mjs'],{cwd:root,env:{...process.env,TMPDIR:root+'/work/test-tmp',TEMP:root+'/work/test-tmp',TMP:root+'/work/test-tmp'},stdio:['ignore','pipe','pipe']});
    let output='';
    child.stdout.on('data',b=>{output+=b.toString();run.log=output.slice(-12000);});
    child.stderr.on('data',b=>{output+=b.toString();run.log=output.slice(-12000);});
    child.on('close',code=>{const passed=output.match(/ℹ pass (\d+)/)?.[1];const failed=output.match(/ℹ fail (\d+)/)?.[1];run={...run,status:code===0?'PASS':'FAIL',finishedAt:new Date().toISOString(),passed:passed?Number(passed):null,failed:failed?Number(failed):null,log:output.slice(-12000)||'未返回测试输出。'};});
    return snapshot();
  }
  return {snapshot,start};
}
