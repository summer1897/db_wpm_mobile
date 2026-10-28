import { defineConfig } from 'vite';
import uniPlugin from '@dcloudio/vite-plugin-uni';
const uni = (uniPlugin as unknown as { default?: typeof uniPlugin }).default || uniPlugin;
export default defineConfig({
  plugins: [uni()],
  server: {
    port: 5188,
    strictPort: true,
    proxy: {
      '/api/mobile/v1': {
        target: 'http://127.0.0.1:' + (process.env.WIND_MOBILE_GATEWAY_PORT || 8791),
        changeOrigin: true,
      },
      // nest-admin 后端：H5 预览留空服务器地址时走同源 /api，由这里转发。
      '/api': {
        target: 'http://127.0.0.1:' + (process.env.WIND_API_PORT || 7001),
        changeOrigin: true,
      },
    },
  },
});
