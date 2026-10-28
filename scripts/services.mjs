import { createMobileService } from '../server/service.mjs';
import { createMobileGateway } from '../server/gateway.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
const root = fileURLToPath(new URL('../', import.meta.url));
const data = resolve(process.env.WIND_MOBILE_DATA_ROOT || resolve(root, '.local-data'));
const apiPort = Number(process.env.WIND_MOBILE_PORT || 8790);
const gatewayPort = Number(process.env.WIND_MOBILE_GATEWAY_PORT || 8791);
const allowedOrigins = [
  'http://127.0.0.1:5188',
  'http://localhost:5188',
  ...(process.env.WIND_MOBILE_ORIGINS || '').split(',').filter(Boolean),
];
let api,
  gateway,
  closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await gateway?.close();
  await api?.close();
  if (process.connected) process.disconnect();
}
try {
  api = await createMobileService({
    root: data,
    allowedOrigins,
    ...(process.env.WIND_MOBILE_TRIAL === '1'
      ? {}
      : {
          desktopRoot: resolve(process.env.WIND_DATA_ROOT || resolve(root, '../../Wind-data')),
          desktopOrigin: `http://127.0.0.1:${Number(process.env.WIND_API_PORT || 8787)}`,
        }),
  });
  api.server.listen(apiPort, '127.0.0.1');
  await once(api.server, 'listening');
  gateway = createMobileGateway({
    upstreamOrigin: `http://127.0.0.1:${apiPort}`,
    allowedOrigins,
  });
  gateway.server.listen(gatewayPort, process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1');
  await once(gateway.server, 'listening');
  console.log(
    `施工移动端服务已启动：${gatewayPort}。${process.env.WIND_MOBILE_TRIAL === '1' ? '隔离测试模式，不写入正式项目。' : '施工记录统一提交至电脑端资料服务，请同时启动数字化管理平台。'}`,
  );
} catch (error) {
  console.error(
    error.code === 'EADDRINUSE'
      ? `移动端服务端口已被占用，请停止旧手机服务后重试；未关闭其他程序。`
      : error.message,
  );
  await close();
  process.exitCode = 1;
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.on('disconnect', close);
process.on('message', (value) => {
  if (value?.type === 'shutdown') void close();
});
