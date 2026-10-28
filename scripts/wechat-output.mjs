/** 完整编译后再替换运行文件，避免 Vite 清空微信正在读取的 client，导致模拟器丢失脚本和样式。 */
import { readdir, readFile, mkdir, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function publishWechatOutput(staging, destination) {
  staging = resolve(staging);
  destination = resolve(destination);
  const contains = (parent, child) => child === parent || child.startsWith(parent + sep);
  if (contains(staging, destination) || contains(destination, staging))
    throw new Error('微信编译暂存目录和运行目录必须分开');
  const files = [];
  async function scan(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('微信编译目录不能包含符号链接');
      const path = resolve(folder, item.name);
      if (item.isDirectory()) await scan(path);
      else if (item.isFile()) files.push(relative(staging, path));
    }
  }
  await scan(staging);
  const app = JSON.parse(await readFile(resolve(staging, 'app.json'), 'utf8'));
  if (!Array.isArray(app.pages) || !app.pages.length) throw new Error('微信编译结果缺少页面');
  const required = [
    'app.json',
    'app.js',
    'app.wxss',
    ...app.pages.flatMap((page) => ['.js', '.json', '.wxml', '.wxss'].map((ext) => page + ext)),
  ];
  for (const file of required) {
    if (!contains(staging, resolve(staging, file)) || !files.includes(file.replaceAll('/', sep)))
      throw new Error('微信编译结果不完整：' + file);
  }
  // 先验证全部目标路径，避免目录链接或文件冲突将更新写到运行目录之外。
  const safe = async (path, directory) => {
    const info = await lstat(path).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info && (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())))
      throw new Error('微信输出路径类型异常：' + path);
  };
  await safe(destination, true);
  for (const file of files) {
    let folder = dirname(resolve(destination, file));
    while (folder !== destination) {
      await safe(folder, true);
      folder = dirname(folder);
    }
    await safe(resolve(destination, file), false);
  }
  // 入口最后更新；未变化的文件不重写，减少开发者工具在更新期间重复重载。
  const order = (file) => (file === 'app.json' ? 2 : file === 'app.js' ? 1 : 0);
  files.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  let changed = 0;
  for (const file of files) {
    const target = resolve(destination, file);
    const data = await readFile(resolve(staging, file));
    const previous = await readFile(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (previous?.equals(data)) continue;
    await mkdir(dirname(target), { recursive: true });
    const temporary = target + '.next-' + randomUUID();
    try {
      await writeFile(temporary, data, { flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    changed++;
  }
  return changed;
}
