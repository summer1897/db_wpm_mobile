/** 在临时目录验证编译输出，绝不清理微信真实缓存或项目数据。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishWechatOutput } from '../scripts/wechat-output.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wind-wx-output-'));
  const staging = join(root, 'staging'),
    destination = join(root, 'client');
  await mkdir(join(staging, 'pages/login'), { recursive: true });
  await mkdir(destination);
  const files = {
    'app.json': JSON.stringify({ pages: ['pages/login/index'] }),
    'app.js': 'app-new',
    'app.wxss': 'button{background:green}',
    'pages/login/index.js': 'page-new',
    'pages/login/index.json': '{}',
    'pages/login/index.wxml': '<button type="primary">注册并进入</button>',
    'pages/login/index.wxss': 'button{color:white}',
  };
  for (const [name, value] of Object.entries(files)) await writeFile(join(staging, name), value);
  await writeFile(join(destination, 'app.json'), 'old-app');
  await writeFile(join(destination, 'project.private.config.json'), 'user-private-config');
  return { staging, destination, files };
}

test('微信完整编译后更新运行文件，保留本地配置，未变化文件不重复写入', async () => {
  const { staging, destination, files } = await fixture();
  assert.equal(await publishWechatOutput(staging, destination), Object.keys(files).length);
  for (const [name, value] of Object.entries(files))
    assert.equal(await readFile(join(destination, name), 'utf8'), value);
  assert.equal(
    await readFile(join(destination, 'project.private.config.json'), 'utf8'),
    'user-private-config',
  );
  const before = (await stat(join(destination, 'app.json'))).mtimeMs;
  assert.equal(await publishWechatOutput(staging, destination), 0);
  assert.equal((await stat(join(destination, 'app.json'))).mtimeMs, before);
  assert.ok(!(await readdir(destination)).some((name) => name.includes('.next-')));
});

test('不完整编译不能覆盖正在运行的项目入口', async () => {
  const { staging, destination } = await fixture();
  await writeFile(join(staging, 'app.json'), JSON.stringify({ pages: ['pages/missing/index'] }));
  await assert.rejects(publishWechatOutput(staging, destination), /不完整/);
  assert.equal(await readFile(join(destination, 'app.json'), 'utf8'), 'old-app');
  assert.deepEqual((await readdir(destination)).sort(), [
    'app.json',
    'project.private.config.json',
  ]);
});

test('目标文件冲突在更新前发现，原运行文件保持不变', async () => {
  const { staging, destination } = await fixture();
  await mkdir(join(destination, 'app.js'));
  await assert.rejects(publishWechatOutput(staging, destination), /路径类型异常/);
  assert.equal(await readFile(join(destination, 'app.json'), 'utf8'), 'old-app');
});

test('编译目录和运行目录嵌套时拒绝更新', async () => {
  const { staging } = await fixture();
  await assert.rejects(publishWechatOutput(staging, staging), /必须分开/);
  await assert.rejects(publishWechatOutput(staging, join(staging, 'client')), /必须分开/);
});
