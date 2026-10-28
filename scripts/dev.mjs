/** 不关闭其他程序。只复用实例指纹和版本均匹配的移动端服务，避免误连到别的项目。 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
const root = fileURLToPath(new URL('../', import.meta.url));
const lan = process.argv.includes('--lan');
const production = process.argv.includes('--preview');
const port = Number(process.env.WIND_MOBILE_WEB_PORT || 5188),
  gatewayPort = Number(process.env.WIND_MOBILE_GATEWAY_PORT || 8791);
const instance = createHash('sha256')
  .update(resolve(process.env.WIND_MOBILE_DATA_ROOT || resolve(root, '.local-data')))
  .digest('hex');
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((row) => row?.family === 'IPv4' && !row.internal)
  .map((row) => row.address);
const children = [];
let closing = false;
function start(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    close();
  });
  child.on('exit', (code) => {
    if (!closing) {
      process.exitCode = code || 0;
      close();
    }
  });
  return child;
}
function close() {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    if (child.spawnargs.some((arg) => arg.includes('uni.js'))) child.kill();
  }
  if (process.connected) process.disconnect();
}
let gateway;
try {
  const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/mobile/v1/config`, {
    signal: AbortSignal.timeout(1200),
  });
  gateway = {
    version: response.headers.get('x-wind-mobile-gateway'),
    config: await response.json(),
  };
} catch {
  /* 未启动，交由本次开发进程管理。 */
}
if (gateway && (gateway.config.instance !== instance || gateway.version !== 'uniapp-1'))
  throw new Error(
    `${gatewayPort} 仍是旧手机服务或其他项目，请停止其原终端后重试；不会关闭其他程序。`,
  );
let web;
try {
  web = await fetch(`http://127.0.0.1:${port}`, {
    signal: AbortSignal.timeout(1200),
  }).then((response) => response.text());
} catch {}
if (web && !web.includes('uni-app-v1'))
  throw new Error(`${port} 端口已被其他页面占用，请停止旧预览后重试`);
if (web && production === web.includes('/src/main.ts'))
  throw new Error('当前运行的预览模式不同，请先在原预览终端按 Ctrl+C，再切换开发/离线体验模式。');
// 页面与登录后台分别核验：仅页面仍在运行时，也要补启缺失的后台。
// 只管理本启动器创建的进程，复用已有页面不会关闭或重启它。
if (!gateway)
  start(['scripts/services.mjs', ...(lan ? ['--lan'] : [])], {
    WIND_MOBILE_ORIGINS: [
      ...(process.env.WIND_MOBILE_ORIGINS || '').split(','),
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      ...(lan ? addresses.map((ip) => `http://${ip}:${port}`) : []),
    ]
      .filter(Boolean)
      .join(','),
  });
if (web) {
  console.log(`统一移动端预览已运行：http://127.0.0.1:${port}`);
} else {
  if (production) start(['scripts/preview.mjs', ...(lan ? ['--lan'] : [])]);
  else
    start([
      'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js',
      '--host',
      lan ? '0.0.0.0' : '127.0.0.1',
      '--port',
      String(port),
    ]);
  console.log(`uni-app 手机预览：http://127.0.0.1:${port}`);
  if (lan) {
    console.log('手机可直接注册项目账号；不要将开发端口直接转发到公网。');
    for (const ip of addresses)
      console.log(`手机测试：http://${ip}:${port}，小程序测试服务：http://${ip}:${gatewayPort}`);
  }
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.on('disconnect', close);
process.on('message', (value) => {
  if (value?.type === 'shutdown') close();
});
