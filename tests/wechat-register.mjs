/** 实际微信编译模块的按钮/输入事件回归；文件与账号全部使用临时目录，不接触用户资料。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  accessSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createTestMobileService as createMobileService } from './account-fixture.mjs';
import { createMobileGateway } from '../server/gateway.mjs';

test('微信编译页面：灰置问题、无损恢复、未配置提示、真实注册及重复点击保护', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wind-wx-register-'));
  const app = await createMobileService({ root: join(root, 'server') });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const gateway = createMobileGateway({
    upstreamOrigin: `http://127.0.0.1:${app.server.address().port}`,
  });
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const build = fileURLToPath(new URL('../../miniprogram/client/', import.meta.url));
  const clientRoot = join(root, 'client');
  mkdirSync(clientRoot);
  const toasts = [],
    navigations = [],
    requests = [],
    active = new Set(),
    cache = new Map(),
    loads = [];
  let proxyUnavailable = false,
    denyStorage = true,
    page;
  const fs = {
    mkdirSync: (path, recursive) => mkdirSync(path, { recursive }),
    accessSync,
    readdirSync: (path) => {
      if (denyStorage) throw new Error('EACCES');
      return readdirSync(path);
    },
    readFileSync,
    writeFile: ({ filePath, data, encoding, success, fail }) => {
      try {
        writeFileSync(filePath, data, encoding);
        success({});
      } catch (error) {
        fail(error);
      }
    },
    readFile: ({ filePath, encoding, success, fail }) => {
      try {
        success({ data: readFileSync(filePath, encoding) });
      } catch (error) {
        fail(error);
      }
    },
  };
  const wx = {
    env: { USER_DATA_PATH: clientRoot },
    getFileSystemManager: () => fs,
    getStorageInfoSync: () => ({ keys: [] }),
    getStorageSync: () => {
      throw new Error('不存在的缓存不得读取');
    },
    createPage: (value) => {
      page = value;
    },
  };
  const uni = {
    getNetworkType: (input) => {
      input.success({ networkType: 'wifi' });
      input.complete();
    },
    onNetworkStatusChange() {},
    hideToast() {},
    showToast: (input) => toasts.push(input.title),
    switchTab: (input) => navigations.push(input.url),
    navigateTo: (input) => navigations.push(input.url),
    reLaunch: (input) => navigations.push(input.url),
    request(input) {
      const controller = new AbortController();
      const task = { abort: () => controller.abort() };
      active.add(task);
      requests.push(input.url);
      if (proxyUnavailable) {
        queueMicrotask(() => {
          input.success({ statusCode: 500, data: '' });
          active.delete(task);
          input.complete();
        });
        return task;
      }
      void fetch(input.url, {
        method: input.method,
        headers: input.header,
        body: input.method === 'POST' ? JSON.stringify(input.data) : undefined,
        signal: controller.signal,
      })
        .then(async (response) =>
          input.success({
            statusCode: response.status,
            data: await response.json(),
          }),
        )
        .catch((error) => input.fail(error))
        .finally(() => {
          active.delete(task);
          input.complete();
        });
      return task;
    },
  };
  const vendor = {
    wx$1: wx,
    index: uni,
    reactive: (value) => value,
    ref: (value) => ({ value }),
    computed: (getter) => Object.defineProperty({}, 'value', { get: getter }),
    onLoad: (callback) => loads.push(callback),
    onShow() {},
    defineComponent: (value) => value,
    _export_sfc: (value) => value,
    e: (...values) => Object.assign({}, ...values),
    p: (value) => value,
    t: (value) => String(value),
    o: (callback) => callback,
    f: (values, callback) => values.map(callback),
    unref: (value) => value,
  };
  function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    runInNewContext(
      readFileSync(file, 'utf8'),
      {
        module,
        exports: module.exports,
        wx,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        require: (name) =>
          name.endsWith('common/vendor.js') ? vendor : load(resolve(dirname(file), name)),
      },
      { filename: file },
    );
    return module.exports;
  }
  const store = load(join(build, 'modules/work/store.js'));
  load(join(build, 'pages/login/index.js'));
  const render = page.setup({});
  const wxml = readFileSync(join(build, 'pages/login/index.wxml'), 'utf8');
  const tag = (pattern) =>
    [...wxml.matchAll(/<(?:button|input)\b[^>]*>/g)]
      .map((match) => match[0])
      .find((value) => pattern.test(value));
  const prop = (value, name) => {
    const match = new RegExp(name + '="\\{\\{([\\w$]+)\\}\\}"').exec(value || '');
    assert.ok(match, `编译绑定缺失：${name}`);
    return match[1];
  };
  const submitTag = tag(/class="primary login-submit/),
    toggleTag = tag(/class="plain-button register-button/);
  assert.match(
    submitTag,
    /background-color:\s*#23664e/,
    '主按钮自身携带背景颜色，不只依赖全局样式',
  );
  const userTag = tag(/placeholder="输入用户名"/),
    passwordTag = tag(/placeholder="输入密码"/);
  const ui = () => render({}, {});
  const clickSubmit = () => ui()[prop(submitTag, 'bindtap')]();
  const fill = (value, text) => ui()[prop(value, 'bindinput')]({ detail: { value: text } });
  async function idle() {
    const deadline = Date.now() + 5000;
    while (active.size && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
    assert.equal(active.size, 0);
    await store.reload();
  }
  try {
    for (const callback of loads) await callback();
    assert.equal(store.state.local, null);
    assert.equal(ui()[prop(submitTag, 'disabled')], false, '本机错误不能把按钮永久灰置');
    ui()[prop(toggleTag, 'bindtap')]();
    fill(userTag, 'wechat-ui-worker');
    fill(passwordTag, 'test-pass-2026');
    await clickSubmit();
    assert.equal(requests.length, 0, '本机资料未打开时不得向后台注册');
    assert.ok(toasts.some((value) => /资料目录/.test(value)));
    assert.equal(ui()[prop(submitTag, 'disabled')], false, '失败后必须恢复可操作');
    denyStorage = false;
    await clickSubmit();
    assert.ok(store.state.local);
    assert.match(store.state.error, /配置项目服务地址/);
    assert.equal(requests.length, 0, '未配置服务时不误发账号');
    assert.equal(ui()[prop(userTag, 'value')], 'wechat-ui-worker');
    assert.equal(ui()[prop(passwordTag, 'value')], 'test-pass-2026');
    await store.setEndpoint(origin);
    proxyUnavailable = true;
    await clickSubmit();
    assert.match(store.state.error, /手机后台服务暂时不可用.*HTTP 500/);
    assert.equal(
      requests.filter((url) => url.endsWith('/auth/register')).length,
      0,
      '后台不可用时不发送注册请求',
    );
    assert.equal(ui()[prop(submitTag, 'disabled')], false, '后台不可用后仍可重试');
    proxyUnavailable = false;
    const submitting = clickSubmit();
    assert.equal(ui()[prop(submitTag, 'disabled')], true, '仅处理期间阻止重复点击');
    await clickSubmit();
    await submitting;
    await idle();
    assert.equal(requests.filter((url) => url.endsWith('/auth/register')).length, 1);
    assert.equal(store.state.user.role, 'worker');
    assert.equal(store.state.user.username, 'wechat-ui-worker');
    assert.ok(navigations.includes('/pages/home/index'));
    assert.equal(ui()[prop(passwordTag, 'value')], '');
    assert.equal(ui()[prop(submitTag, 'disabled')], false);
    const snapshots = readdirSync(join(clientRoot, 'wind-field'))
      .map((name) => readFileSync(join(clientRoot, 'wind-field', name), 'utf8'))
      .join('');
    assert.ok(!snapshots.includes('test-pass-2026'), '本机台账不得保存密码');
    assert.ok(!snapshots.includes('"token"'), '本机台账不得保存会话令牌');
  } finally {
    store.stopForeground();
    await gateway.close();
    await app.close();
  }
});
