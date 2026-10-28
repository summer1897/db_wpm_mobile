import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createMobileService } from './service.mjs';

const root = resolve(
  process.env.WIND_MOBILE_DATA_ROOT || fileURLToPath(new URL('../.local-data/', import.meta.url)),
);
const port = Number(process.env.WIND_MOBILE_PORT || 8790);
const allowedOrigins = (process.env.WIND_MOBILE_ORIGINS || '').split(',').filter(Boolean);
const app = await createMobileService({
  root,
  allowedOrigins,
  ...(process.env.WIND_MOBILE_TRIAL === '1'
    ? {}
    : {
        desktopRoot: resolve(
          process.env.WIND_DATA_ROOT ||
            fileURLToPath(new URL('../../../Wind-data/', import.meta.url)),
        ),
        desktopOrigin: `http://127.0.0.1:${Number(process.env.WIND_API_PORT || 8787)}`,
      }),
});
app.server.on('error', async (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `手机服务端口 ${port} 已被占用，请停止原手机服务；不会自动关闭其他程序。`
      : error.message,
  );
  await app.close();
  process.exitCode = 1;
});
app.server.listen(port, '127.0.0.1', () =>
  console.log(
    `风电施工现场管理服务已启动：127.0.0.1:${port}\n正式模式与电脑端共用施工资料台账，支持工作人员与管理人员注册。`,
  ),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  // 让事件循环自然退出，避免 Windows Node 在 fetch 连接清理期间强制退出触发断言。
  process.exitCode = 0;
  if (process.connected) process.disconnect();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.on('message', (value) => {
  if (value?.type === 'shutdown') void close();
});
process.on('disconnect', close);
