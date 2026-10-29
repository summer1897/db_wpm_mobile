/**
 * 本地 H5 预览启动器：只起前端页面。
 * 接口由 nest-admin 提供，地址在 src/config/deployment.ts 配置，本脚本不再启动旧的本地模拟服务。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
const root = fileURLToPath(new URL('../', import.meta.url));
const lan = process.argv.includes('--lan');
const production = process.argv.includes('--preview');
const port = Number(process.env.WIND_MOBILE_WEB_PORT || 5188);
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((row) => row?.family === 'IPv4' && !row.internal)
  .map((row) => row.address);
const children = [];
let closing = false;
function start(args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: process.env,
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
if (web) {
  console.log(`移动端预览已运行：http://127.0.0.1:${port}`);
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
  console.log('接口服务请另开终端启动 nest-admin（默认 http://127.0.0.1:8088）。');
  if (lan) {
    for (const ip of addresses) console.log(`手机可直接访问：http://${ip}:${port}`);
  }
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.on('disconnect', close);
process.on('message', (value) => {
  if (value?.type === 'shutdown') close();
});
