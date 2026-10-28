import { createSSRApp } from 'vue';
import App from './App.vue';
// #ifdef H5
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {
      /* 私密模式可能禁止缓存；仍保留 IndexedDB 存储和在线填报能力。 */
    });
  });
// #endif
export function createApp() {
  return { app: createSSRApp(App) };
}
