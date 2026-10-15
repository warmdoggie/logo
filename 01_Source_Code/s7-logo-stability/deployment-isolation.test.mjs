import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(fileURLToPath(import.meta.url));
const DEPLOY=join(ROOT,'..','deploy','s7-logo-stability');

test('workspace systemd service runs S7 and the workspace in one process',async()=>{
  const service=await readFile(join(DEPLOY,'s7-workspace.service'),'utf8');
  assert.match(service,/User=s7-logo/);
  assert.match(service,/WorkingDirectory=\/srv\/s7-logo/);
  assert.match(service,/Environment=PORT=3210/);
  assert.match(service,/Environment=APP_DATA_DIR=\/var\/lib\/s7-logo\/workspace/);
  assert.match(service,/Environment=APP_NO_SEED=1/);
  assert.match(service,/ExecStart=\/usr\/bin\/node \/srv\/s7-logo\/server\.mjs/);
  assert.doesNotMatch(service,/3237|s7-logo\.service/);
  assert.doesNotMatch(service,/\/srv\/frame|\/etc\/frame|frame-operations|3000/);
});

test('Nginx routes the workspace and S7 path to the same listener',async()=>{
  const nginx=await readFile(join(DEPLOY,'logo.heciai.net.nginx.conf'),'utf8');
  assert.match(nginx,/server_name logo\.heciai\.net/);
  assert.match(nginx,/location \/s7\//);
  assert.equal((nginx.match(/proxy_pass http:\/\/127\.0\.0\.1:3210/g)||[]).length,2);
  assert.doesNotMatch(nginx,/3237/);
  assert.match(nginx,/auth_basic_user_file \/etc\/nginx\/\.htpasswd-s7-logo/);
  assert.doesNotMatch(nginx,/frame\.heciai\.net|127\.0\.0\.1:3000|frame-operations/);
});

test('workspace embeds S7 on the main workspace origin',async()=>{
  const app=await readFile(join(ROOT,'..','public','app.js'),'utf8');
  assert.match(app,/iframe src="\/s7\//);
  assert.doesNotMatch(app,/3237/);
  const server=await readFile(join(ROOT,'..','server.mjs'),'utf8');
  assert.match(server,/createDemoHandler/);
  assert.match(server,/path==='\/s7'\|\|path\.startsWith\('\/s7\/'\)/);
  const demo=await readFile(join(ROOT,'demo.js'),'utf8');
  assert.match(demo,/S7_BASE/);
  assert.match(demo,/s7Path\(product\.imageUrl\)/);
});

test('S7 production config example keeps credentials outside the repository',async()=>{
  const env=await readFile(join(DEPLOY,'production.env.example'),'utf8');
  const config=await readFile(join(DEPLOY,'ai-provider.json.example'),'utf8');
  assert.match(env,/S7_AI_CONFIG=\/etc\/s7-logo\/ai-provider\.json/);
  assert.doesNotMatch(env,/S7_PORT=3237/);
  assert.match(config,/gpt-image-2\.5-flare/);
  assert.match(config,/REPLACE_ON_SERVER/);
  assert.doesNotMatch(config,/sk-[A-Za-z0-9]{20,}/);
});
