/** 由代码内矢量生成小程序兼容 PNG，保持图标笔画一致；不依赖线上图标库。 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const paths = {
  settings:
    '<path d="M4 6h3m5 0h8M4 12h9m5 0h2M4 18h3m5 0h8"/><circle cx="9.5" cy="6" r="2.3"/><circle cx="15.5" cy="12" r="2.3"/><circle cx="9.5" cy="18" r="2.3"/>',
  manager:
    '<path d="m12 3 8 3v5c0 4.6-3.6 8-8 10-4.4-2-8-5.4-8-10V6l8-3Z"/><path d="m8.5 11.7 2.3 2.3 4.7-4.7"/>',
  worker: '<path d="M4 14v-2a8 8 0 0 1 5-7m6 0a8 8 0 0 1 5 7v2M9 10V4h6v6M3 14h18v4H3zM5 21h14"/>',
  chart: '<path d="M4 4v16h17M8 15v-3m5 3V9m5 6V5"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':
    '<path d="m3 3 18 18M9.8 5.2c6.8-1.8 12.2 6.8 12.2 6.8a21 21 0 0 1-4 4M6 6c-2.5 2-4 6-4 6s3.5 7 10 7c1.4 0 2.7-.3 4-.8"/>',
};
for (const [name, content] of Object.entries(paths))
  for (const active of [false, true])
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${active ? '#39674b' : '#85957c'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`,
      ),
    )
      .png()
      .toFile(resolve(root, `src/static/icons/${name}${active ? '-active' : ''}.png`));
await sharp(resolve(root, 'scripts/assets/wind-farm-source.png'))
  .resize({ width: 960, withoutEnlargement: true })
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(resolve(root, 'src/static/wind-farm.jpg'));
console.log('本地静态资源已生成');
