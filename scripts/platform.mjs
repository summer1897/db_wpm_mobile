/** VS Code 统一编译入口：微信输出到原 miniprogram/client，APP 这里只生成资源而非签名安装包。 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { publishWechatOutput } from './wechat-output.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, platform] = process.argv.slice(2);
if (!['dev', 'build'].includes(mode) || !['mp-weixin', 'app'].includes(platform))
  throw new Error('编译参数无效');
const output =
  process.env.UNI_OUTPUT_DIR ||
  (platform === 'mp-weixin'
    ? resolve(root, '../miniprogram/client')
    : resolve(root, 'dist/build/app'));
if (
  platform === 'mp-weixin' &&
  !process.env.UNI_OUTPUT_DIR &&
  !output.startsWith(resolve(root, '..') + '\\')
)
  throw new Error('微信输出目录超出项目范围');
const cli = resolve(root, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js');
// 正式编译只清理暂存目录；编译成功前保持微信开发者工具的运行目录完整。
const stagedWechat = platform === 'mp-weixin' && mode === 'build';
const compilerOutput = stagedWechat ? resolve(root, 'dist/compiler/mp-weixin') : output;
const child = spawn(
  process.execPath,
  [cli, ...(mode === 'build' ? ['build'] : []), '-p', platform],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, UNI_OUTPUT_DIR: compilerOutput },
  },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', async (code) => {
  process.exitCode = code === 0 ? 0 : code || 1;
  if (code === 0 && stagedWechat) {
    try {
      const path = resolve(compilerOutput, 'project.config.json');
      const config = JSON.parse(await readFile(path, 'utf8'));
      const prior = await readFile(resolve(root, '../miniprogram/project.config.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      if (prior?.appid && prior.appid !== 'touristappid') config.appid = prior.appid;
      config.setting = { ...config.setting, urlCheck: true };
      await writeFile(path, JSON.stringify(config, null, 2));
      const changed = await publishWechatOutput(compilerOutput, output);
      console.log(`微信小程序已完整更新：${output}（${changed} 个文件）`);
    } catch (error) {
      console.error('微信运行文件更新失败：' + error.message);
      process.exitCode = 1;
    }
  }
  if (code === 0 && platform === 'app')
    console.log(
      'APP 资源已生成。安装包需 DCloud AppID、HBuilderX 打包及 Android/iOS 签名；资源编译不等同真机验证。',
    );
});
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
