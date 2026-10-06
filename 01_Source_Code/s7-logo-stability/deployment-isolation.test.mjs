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

test('S7 Nginx template uses a separate host and loopback port',async()=>{
  const nginx=await readFile(join(DEPLOY,'logo.heciai.net.nginx.conf'),'utf8');
  assert.match(nginx,/server_name logo\.heciai\.net/);
  assert.match(nginx,/proxy_pass http:\/\/127\.0\.0\.1:3237/);
  assert.match(nginx,/auth_basic_user_file \/etc\/nginx\/\.htpasswd-s7-logo/);
  assert.doesNotMatch(nginx,/frame\.heciai\.net|127\.0\.0\.1:3000|frame-operations/);
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
