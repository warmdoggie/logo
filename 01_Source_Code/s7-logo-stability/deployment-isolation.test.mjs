import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(fileURLToPath(import.meta.url));
const DEPLOY=join(ROOT,'..','deploy','s7-logo-stability');

test('S7 systemd service is isolated from FRAME',async()=>{
  const service=await readFile(join(DEPLOY,'s7-logo.service'),'utf8');
  assert.match(service,/User=s7-logo/);
  assert.match(service,/WorkingDirectory=\/srv\/s7-logo/);
  assert.match(service,/S7_AI_CONFIG=\/etc\/s7-logo\/ai-provider\.json/);
  assert.match(service,/Environment=S7_PORT=3237/);
  assert.doesNotMatch(service,/\/srv\/frame|\/etc\/frame|frame-operations|3000/);
});

test('workspace systemd service runs the merged application on its own loopback port',async()=>{
  const service=await readFile(join(DEPLOY,'s7-workspace.service'),'utf8');
  assert.match(service,/User=s7-logo/);
  assert.match(service,/WorkingDirectory=\/srv\/s7-logo/);
  assert.match(service,/Environment=PORT=3210/);
  assert.match(service,/Environment=APP_DATA_DIR=\/var\/lib\/s7-logo\/workspace/);
  assert.match(service,/Environment=APP_NO_SEED=1/);
  assert.match(service,/ExecStart=\/usr\/bin\/node \/srv\/s7-logo\/server\.mjs/);
  assert.doesNotMatch(service,/\/srv\/frame|\/etc\/frame|frame-operations|3000/);
});

test('Nginx serves the merged workspace and exposes S7 only under the same-origin route',async()=>{
  const nginx=await readFile(join(DEPLOY,'logo.heciai.net.nginx.conf'),'utf8');
  assert.match(nginx,/server_name logo\.heciai\.net/);
  assert.match(nginx,/location \/s7\//);
  assert.match(nginx,/proxy_pass http:\/\/127\.0\.0\.1:3237\//);
  assert.match(nginx,/location \/[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:3210/);
  assert.match(nginx,/auth_basic_user_file \/etc\/nginx\/\.htpasswd-s7-logo/);
  assert.doesNotMatch(nginx,/frame\.heciai\.net|127\.0\.0\.1:3000|frame-operations/);
});

test('workspace embeds S7 through the public same-origin path instead of visitor localhost',async()=>{
  const app=await readFile(join(ROOT,'..','public','app.js'),'utf8');
  assert.match(app,/iframe src="\/s7\/\?v=\$\{Date\.now\(\)\}"/);
  assert.doesNotMatch(app,/iframe src="http:\/\/127\.0\.0\.1:3237/);
  const demo=await readFile(join(ROOT,'demo.js'),'utf8');
  assert.match(demo,/S7_BASE/);
  assert.match(demo,/s7Path\(product\.imageUrl\)/);
});

test('S7 production config example keeps credentials outside the repository',async()=>{
  const env=await readFile(join(DEPLOY,'production.env.example'),'utf8');
  const config=await readFile(join(DEPLOY,'ai-provider.json.example'),'utf8');
  assert.match(env,/S7_PORT=3237/);
  assert.match(env,/S7_AI_CONFIG=\/etc\/s7-logo\/ai-provider\.json/);
  assert.match(config,/gpt-image-2\.5-flare/);
  assert.match(config,/REPLACE_ON_SERVER/);
  assert.doesNotMatch(config,/sk-[A-Za-z0-9]{20,}/);
});
