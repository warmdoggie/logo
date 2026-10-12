import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {basename,resolve} from 'node:path';
import {parsePantoneText,validatePantoneColors} from './pantone-colors.mjs';

const [, , sourceArg, outputArg]=process.argv;
if(!sourceArg||!outputArg)throw new Error('用法：node generate-pantone-data.mjs <PDF> <输出 JSON>');
const source=resolve(sourceArg),output=resolve(outputArg);
const extracted=spawnSync('pdftotext',['-layout',source,'-'],{encoding:'utf8'});
if(extracted.error||extracted.status!==0)throw extracted.error||new Error(extracted.stderr||'PDF 文本提取失败');
const colors=parsePantoneText(extracted.stdout);
const report=validatePantoneColors(colors);
if(report.invalid||report.count!==4780)throw new Error(`潘通数据校验失败：${JSON.stringify(report)}`);
writeFileSync(output,JSON.stringify({version:1,source:{fileName:basename(source),pageCount:160,description:'用户提供的潘通电子色卡，RGB 为 PDF 中的电子模拟值'},notice:'不同显示设备可能存在差异，实际生产请以最新出版的实物色卡为准。',colors},null,2)+'\n');
console.log(JSON.stringify({output,report},null,2));
