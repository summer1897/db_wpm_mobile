/** H5 生产预览缓存应用资源，离线跳转/重载仍能打开表单；绝不缓存账号、API 或施工照片。 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(
  process.execPath,
  [resolve(root, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js'), 'build'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, UNI_PLATFORM: 'h5' } },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', async (code) => {
  if (code) {
    process.exitCode = code;
    return;
  }
  try {
    const directory = resolve(root, 'dist/build/h5');
    const files = [];
    async function scan(folder) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = resolve(folder, entry.name);
        if (entry.isDirectory()) await scan(path);
        else if (
          /\.(html|js|css|png|jpe?g|webp|woff2?)$/.test(entry.name) &&
          entry.name !== 'sw.js'
        )
          files.push(path);
      }
    }
    await scan(directory);
    const hash = createHash('sha256');
    for (const file of files.sort()) hash.update(await readFile(file));
    const version = hash.digest('hex').slice(0, 16);
    const assets = files.map((file) => './' + relative(directory, file).replaceAll('\\', '/'));
    const source = `const CACHE='wind-field-shell-${version}';
const URLS=${JSON.stringify(assets)};
const ROOT=new URL('./',self.location.href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('wind-field-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==ROOT.origin||url.pathname.includes('/api/'))return;const local=url.pathname.slice(ROOT.pathname.length);if(url.pathname!==ROOT.pathname&&!URLS.includes('./'+local))return;event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname===ROOT.pathname?new URL('index.html',ROOT):event.request)).then(cached=>cached||fetch(event.request)));});`;
    await writeFile(resolve(directory, 'sw.js'), source);
    console.log('H5 离线应用资源已生成（不缓存接口或私人资料）');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
});
