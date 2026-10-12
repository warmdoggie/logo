import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const root = new URL('./', import.meta.url);

test('主工作区登记 S7，并保留独立启动与访问入口', async () => {
  const registry = JSON.parse(await readFile(new URL('./modules.json', root), 'utf8'));
  const s7 = registry.modules.find((module) => module.id === 's7-logo-stability');

  assert.ok(s7, 'modules.json 应登记 s7-logo-stability');
  assert.equal(s7.source, '01_Source_Code/s7-logo-stability');
  assert.equal(s7.startScript, '01_Source_Code/start-s7.ps1');
  assert.equal(s7.localUrl, 'http://127.0.0.1:3237/');
  assert.equal(s7.isolated, true);

  await access(new URL(`./${s7.source}/demo-server.mjs`, root), constants.F_OK);
  await access(new URL(`./${s7.startScript}`, root), constants.F_OK);
  await access(new URL('./start-module.ps1', root), constants.F_OK);

  const launcher = await readFile(new URL('./start-module.ps1', root), 'utf8');
  assert.equal(
    [...launcher].some((character) => character.charCodeAt(0) > 127),
    false,
    'Windows PowerShell 入口应只使用 ASCII，避免 UTF-8 无 BOM 被按 ANSI 解析'
  );

  const mainWorkspace = await readFile(new URL('./01_Source_Code/public/index.html', root), 'utf8');
  assert.match(mainWorkspace, /data-module="s7-logo-stability"/);
  assert.match(mainWorkspace, /href="#\/modules\/s7-logo-stability"/);

  const mainApp = await readFile(new URL('./01_Source_Code/public/app.js', root), 'utf8');
  assert.match(mainApp, /path!?==['"]\/modules\/s7-logo-stability['"]/);
  assert.match(mainApp, /iframe src="\/s7\/\?v=\$\{Date\.now\(\)\}"/);

  const mainServer = await readFile(new URL('./01_Source_Code/server.mjs', root), 'utf8');
  assert.match(mainServer, /frame-src ['"]self['"]/);
});
