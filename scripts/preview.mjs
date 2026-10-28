/** 生产 H5 预览，配置独立于 uni 编译插件；支持检验离线应用壳。 */
import { preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await preview({
  root,
  configFile: false,
  build: { outDir: resolve(root, 'dist/build/h5') },
  preview: {
    host: process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1',
    port: Number(process.env.WIND_MOBILE_WEB_PORT || 5188),
    strictPort: true,
    proxy: {
      '/api/mobile/v1': {
        target: 'http://127.0.0.1:' + (process.env.WIND_MOBILE_GATEWAY_PORT || 8791),
        changeOrigin: true,
      },
    },
  },
});
server.printUrls();
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.httpServer.closeAllConnections();
  server.httpServer.close(() => {
    if (process.connected) process.disconnect();
  });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.on('disconnect', close);
process.on('message', (value) => {
  if (value?.type === 'shutdown') close();
});
