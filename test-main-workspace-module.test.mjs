import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('./', import.meta.url);

test('S7 登记为主工作区内的集成模块', async () => {
  const registry = JSON.parse(await readFile(new URL('./modules.json', root), 'utf8'));
  const s7 = registry.modules.find((module) => module.id === 's7-logo-stability');

  assert.ok(s7, 'modules.json 应登记 s7-logo-stability');
  assert.equal(s7.source, '01_Source_Code/s7-logo-stability');
  assert.equal(s7.startScript, 'start-workspace.ps1');
  assert.equal(s7.localUrl, 'http://127.0.0.1:3210/#/modules/s7-logo-stability');
  assert.equal(s7.isolated, false);

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
  assert.match(mainApp, /path==='\/modules\/s7-logo-stability'/);
  assert.match(mainApp, /iframe src=/);

  const mainServer = await readFile(new URL('./01_Source_Code/server.mjs', root), 'utf8');
  assert.match(mainServer, /createDemoHandler/);
});

test('S7 iframe uses a same-origin route for local and online access', async () => {
  const app = await readFile(new URL('./01_Source_Code/public/app.js', root), 'utf8');
  const render = app.slice(app.indexOf('let s7ModulePanel='), app.indexOf('function renderS7IfRequested()'));
  for (const hostname of ['127.0.0.1', 'localhost', 'logo.heciai.net']) {
    const panels=[],frame={contentWindow:{postMessage(){}}};
    const main = {after:panel=>panels.push(panel)};
    const document={createElement:()=>({querySelector:()=>frame})};
    await runInNewContext(render + ';(async()=>{await renderS7Module();setS7ModuleActive(false);await renderS7Module();})();', { main, document,workspaceAccount:null, location: { hostname,origin:`https://${hostname}` } });
    assert.equal(panels.length,1,'reopening keeps the existing module attached');
    assert.equal(panels[0].innerHTML.match(/iframe src="([^"]+)/)[1], '/s7/');
    assert.equal(main.hidden,true);assert.equal(panels[0].hidden,false);
  }
});

test('workspace CSP allows the integrated S7 iframe without a separate port', async () => {
  const server = await readFile(new URL('./01_Source_Code/server.mjs', root), 'utf8');
  assert.match(server, /frame-src 'self'/);
  assert.match(server, /frame-ancestors 'self'/);
  assert.doesNotMatch(server, /3237/);
});
