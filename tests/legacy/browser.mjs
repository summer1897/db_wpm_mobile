/** 在真实 uni-app H5 产物上走完整页面流程；账号、图片与台账全部使用隔离临时目录。 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createTestMobileService as createMobileService } from './account-fixture.mjs';
import { createMobileGateway } from '../server/gateway.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WIND_QA_PLAYWRIGHT || 'playwright');
const mobileRoot = fileURLToPath(new URL('../', import.meta.url));
const buildRoot = resolve(mobileRoot, 'dist/build/h5');
const output = resolve(mobileRoot, 'artifacts');
await mkdir(output, { recursive: true });
const service = await createMobileService({
  root: await mkdtemp(join(tmpdir(), 'wind-uni-ui-')),
});
service.server.listen(0, '127.0.0.1');
await once(service.server, 'listening');
let gatewayOrigin;
const web = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/mobile/v1/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await fetch(gatewayOrigin + req.url, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(([name]) =>
            [
              'authorization',
              'content-type',
              'x-file-meta',
              'origin',
              'access-control-request-method',
              'access-control-request-headers',
            ].includes(name),
          ),
        ),
        ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }),
      });
      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      });
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const target = resolve(
      buildRoot,
      '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
    );
    if (!target.startsWith(buildRoot + '\\')) {
      res.writeHead(403);
      res.end();
      return;
    }
    const types = {
      '.html': 'text/html;charset=utf-8',
      '.js': 'text/javascript;charset=utf-8',
      '.css': 'text/css;charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
    };
    const content = await readFile(target);
    res.writeHead(200, {
      'Content-Type': types[extname(target)] || 'application/octet-stream',
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
web.listen(0, '127.0.0.1');
await once(web, 'listening');
const base = `http://127.0.0.1:${web.address().port}`;
service.addOrigin(base);
const gateway = createMobileGateway({
  upstreamOrigin: `http://127.0.0.1:${service.server.address().port}`,
  allowedOrigins: [base],
});
gateway.server.listen(0, '127.0.0.1');
await once(gateway.server, 'listening');
gatewayOrigin = `http://127.0.0.1:${gateway.server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const button = (text) => page.locator('uni-button').filter({ hasText: text }).last();
const shot = (name) => page.screenshot({ path: join(output, name + '.png'), fullPage: true });
async function seedProjectLedger() {
  const call = async (path, data, token = '') => {
    if (['/auth/register', '/users'].includes(path)) data = service.registrationFields(data);
    const response = await fetch(base + '/api/mobile/v1' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(data),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const admin = await call('/auth/login', {
    username: 'ui-admin',
    password: 'ui-test-pass',
    role: 'admin',
  });
  const workers = [];
  for (const [username, name] of [
    ['seed-a', '李工'],
    ['seed-b', '周工'],
  ]) {
    await call('/users', { username, name, password: 'seed-test-pass' }, admin.token);
    workers.push(
      await call('/auth/login', { username, password: 'seed-test-pass', role: 'worker' }),
    );
  }
  const image = await readFile(resolve(mobileRoot, 'src/static/wind-farm.jpg'));
  const types = ['foundation', 'road', 'lifting', 'collector', 'substation', 'transport', 'other'];
  const dates = [0, 0, 0, 1, 1, 2, 3, 3, 3, 4, 5, 5, 7, 9, 11, 14, 18, 22];
  const newIds = [];
  for (let index = 0; index < dates.length; index++) {
    const person = workers[index % 2],
      id = crypto.randomUUID(),
      photoId = crypto.randomUUID();
    const dateValue = new Date();
    dateValue.setDate(dateValue.getDate() - dates[index]);
    const date = `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, '0')}-${String(dateValue.getDate()).padStart(2, '0')}`;
    const type = types[index % types.length],
      location = `T${String(20 + index).padStart(2, '0')} 施工区段`;
    const form = new FormData();
    form.append('file', new Blob([image], { type: 'image/jpeg' }), '现场.jpg');
    const photoResponse = await fetch(base + '/api/mobile/v1/photos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + person.token,
        'X-File-Meta': encodeURIComponent(
          JSON.stringify({
            id: photoId,
            recordId: id,
            module: type,
            date,
            location,
            name: '施工照片.jpg',
          }),
        ),
      },
      body: form,
    });
    assert.equal(photoResponse.status, 201);
    const photo = await photoResponse.json();
    const result = await call(
      '/reports',
      {
        id,
        type,
        date,
        location,
        content: '完成当日施工检查、现场照片采集与进度日志归档。',
        photoIds: [photo.id],
      },
      person.token,
    );
    newIds.push(result.serverId);
  }
  await service.domain.store.transaction((data) => {
    for (const [index, id] of newIds.entries())
      if (index % 5 === 0) data.logs.find((row) => row.id === id).reviewStatus = '待审核';
      else if (index % 7 === 0) data.logs.find((row) => row.id === id).reviewStatus = '退回修改';
  });
  return 1 + dates.length;
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    '页面不应横向溢出',
  );
}
try {
  await page.goto(base);
  await page.getByText('记录每一步建设', { exact: true }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, {
          once: true,
        }),
      );
  });
  await page.getByText('还没有账号？先注册', { exact: true }).waitFor();
  assert.equal(await page.locator('.login-input input').nth(0).inputValue(), '');
  assert.equal(await page.locator('.login-input input').nth(1).inputValue(), '');
  await noOverflow();
  const control = await page.locator('.login-settings').boundingBox(),
    icon = await page.locator('.login-settings .field-icon').boundingBox();
  assert.ok(control.width >= 44 && control.height >= 44);
  assert.ok(Math.abs(control.x + control.width / 2 - icon.x - icon.width / 2) < 1);
  assert.ok(
    Math.abs(control.y + control.height / 2 - icon.y - icon.height / 2) < 1,
    '设置图标必须居中，不得裁切',
  );
  await shot('01-登录');
  await page.locator('.login-input input').nth(0).fill('not-registered');
  await page.locator('.login-input input').nth(1).fill('ui-test-pass');
  await button('登录').click();
  await page.getByText('账号尚未注册，请先注册', { exact: true }).waitFor();
  await button('先注册').click();
  await page.locator('.role-option').filter({ hasText: '管理人员' }).click();
  assert.equal(await page.locator('.registration-input input').count(), 1, '管理员注册仅增加姓名');
  await page.locator('.login-input input').nth(0).fill('ui-admin');
  await page.locator('.login-input input').nth(1).fill('ui-test-pass');
  await page.locator('.registration-input input').nth(0).fill('项目负责人');
  await shot('01a-注册选择身份');
  await button('注册并进入').click();
  await page.getByText('项目工作台', { exact: true }).waitFor();
  await noOverflow();
  await shot('02-工作台');
  await button('新增施工记录').click();
  await page.getByText('填写施工记录', { exact: true }).waitFor();
  await page.locator('.picker-value').first().click();
  await page.locator('.uni-picker-view-group').hover();
  await page.mouse.wheel(0, 40);
  await page.locator('.uni-picker-action-confirm:visible').click();
  await page.locator('.picker-value').first().filter({ hasText: '风机基础施工' }).waitFor();
  await page.locator('.field-input input').fill('T08 机位 · 基础施工区');
  await page
    .locator('.field-textarea textarea')
    .fill('完成基础钢筋绑扎检查，模板加固完成，待浇筑准备。');
  const chooser = page.waitForEvent('filechooser');
  await button('拍照 / 相册').click();
  await (
    await chooser
  ).setFiles({
    name: '现场照片.jpg',
    mimeType: 'image/jpeg',
    buffer: await readFile(resolve(mobileRoot, 'src/static/wind-farm.jpg')),
  });
  await page.getByText('照片已保存到本机', { exact: true }).waitFor();
  await noOverflow();
  await shot('03-施工填报');
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await button('保存待上传').waitFor();
  await button('保存待上传').click();
  await page.getByText('记录详情', { exact: true }).waitFor();
  await page.getByText('待上传', { exact: true }).waitFor();
  assert.equal(service.domain.store.data.logs.length, 0);
  await shot('04-离线待上传');
  // 已缓存的生产 H5 在断网时重载，验证本机文字、原图与离线身份均能恢复。
  await page.reload();
  await page.getByText('记录每一步建设', { exact: true }).waitFor();
  assert.equal(await page.locator('.login-input input').nth(0).inputValue(), '');
  await button('继续本机离线填报').click();
  await page.getByText('项目工作台', { exact: true }).waitFor();
  await button('查看我的记录与待上传任务').click();
  await page.getByText('T08 机位 · 基础施工区', { exact: true }).click();
  await page.getByText('待上传', { exact: true }).waitFor();
  assert.equal(await page.locator('.photo-image').count(), 1);
  assert.equal(service.domain.store.data.logs.length, 0);
  await context.setOffline(false);
  await button('登录并上传').click();
  await page.getByText('记录每一步建设', { exact: true }).waitFor();
  await page.locator('.login-input input').nth(0).fill('ui-admin');
  await page.locator('.login-input input').nth(1).fill('ui-test-pass');
  await button('登录').click();
  await page.getByText('项目工作台', { exact: true }).waitFor();
  await page.getByText('最新项目记录', { exact: true }).waitFor();
  await page.getByText('T08 机位 · 基础施工区', { exact: true }).click();
  await page.getByText('审核通过', { exact: true }).waitFor();
  await shot('05-已归档详情');
  assert.equal(service.domain.store.data.logs.length, 1);
  assert.equal(service.domain.store.data.materials.length, 1);
  await service.domain.store.transaction((data) => {
    data.logs[0].reviewStatus = '退回修改';
  });
  await page.locator('.page-head .icon-button').click();
  await page.locator('uni-tabbar .uni-tabbar__label').filter({ hasText: '我的' }).click();
  await button('同步施工记录')
    .count()
    .then(async (count) => {
      if (count) await button('同步施工记录').click();
      else await page.getByText('同步施工记录', { exact: true }).click();
    });
  await page.locator('uni-tabbar .uni-tabbar__label').filter({ hasText: '施工记录' }).click();
  await page.getByText('T08 机位 · 基础施工区', { exact: true }).click();
  await page.getByText('审核不通过', { exact: true }).waitFor();
  for (const width of [320, 430, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.page-head .icon-button').click();
  await page.locator('uni-tabbar .uni-tabbar__label').filter({ hasText: '施工记录' }).click();
  await shot('06-记录列表');
  await page.locator('uni-tabbar .uni-tabbar__label').filter({ hasText: '工作台' }).click();
  await page.getByText('项目工作台', { exact: true }).waitFor();
  // 统计截图的数据通过真实上传/归档接口生成，且仅写入本次临时台账，不是生产页面的模拟数。
  const total = await seedProjectLedger();
  // 保持页面不操作，验证其他人员上传后管理统计会自动更新。
  await page.waitForFunction(
    (expected) => document.querySelector('.hero-total')?.textContent === String(expected),
    total,
    { timeout: 15000 },
  );
  await page.waitForFunction(() => document.querySelectorAll('.chart-loading').length === 0);
  assert.equal(await page.locator('.ledger-canvas').count(), 2);
  const painted = await page
    .locator('.ledger-canvas canvas')
    .first()
    .evaluate((canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let nonempty = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) nonempty++;
      return nonempty;
    });
  assert.ok(painted > 1000, '趋势图必须实际绘制，而不只是空白画布');
  await noOverflow();
  await shot('08-管理人员统计工作台');
  await page.locator('.trend-card').evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await page.locator('.trend-card').screenshot({ path: join(output, '08a-施工趋势图.png') });
  await page.locator('.review-layout').evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await page.locator('.review-layout').screenshot({ path: join(output, '08b-资料审核图.png') });
  await button('用户信息 →').click();
  await page.getByText('用户信息', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.person-card').length === 3);
  const directoryText = await page.locator('body').innerText();
  for (const credential of ['ui-admin', 'ui-test-pass', 'seed-a', 'seed-b'])
    assert.ok(!directoryText.includes(credential));
  assert.ok(directoryText.includes('项目负责人'));
  await noOverflow();
  await shot('12-用户信息');
  await page.locator('.page-head .icon-button').click();
  await page.locator('.date-range uni-button').filter({ hasText: '近7天' }).click();
  await page.locator('.statistics-basis uni-button').filter({ hasText: '按施工日期' }).click();
  await page.waitForFunction(
    (expected) => Number(document.querySelector('.hero-total')?.textContent) < expected,
    total,
  );
  await page.locator('.metric-switch uni-button').filter({ hasText: '照片' }).click();
  for (const width of [320, 430, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await button('查看工作台账').click();
  await page.getByText('项目工作台账', { exact: true }).waitFor();
  await page.waitForFunction(
    (expected) => document.querySelector('.ledger-count')?.textContent === String(expected),
    total,
  );
  await shot('09-管理人员工作台账');
  assert.equal(await page.getByText('李工', { exact: true }).count(), 0);
  assert.equal(await page.getByText('周工', { exact: true }).count(), 0);
  await page.locator('.search-box input').fill('T20');
  assert.equal(await page.locator('.record-card').count(), 1);
  await page.locator('.record-card').first().click();
  await page.getByText('项目台账只读查看', { exact: true }).waitFor();
  await page.locator('.photo-image').waitFor();
  assert.equal(await button('继续编辑').count(), 0);
  await shot('10-跨人员记录查看');
  await page.locator('.page-head .icon-button').click();
  await page.locator('.page-head .icon-button').click();
  await page.locator('uni-tabbar .uni-tabbar__label').filter({ hasText: '我的' }).click();
  await page.getByText('项目服务与账号', { exact: true }).click();
  await page.getByText('开通施工人员账号', { exact: true }).waitFor();
  await shot('07-项目与人员管理');
  await page.locator('.field input').nth(0).fill('ui-worker');
  await page.locator('.field input').nth(1).fill('worker-test-pass');
  assert.equal(
    await page.locator('.registration-input input').count(),
    0,
    '工作人员无需额外注册资料',
  );
  await button('开通账号').click();
  await page.getByText('人员账号已开通', { exact: true }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.field input')].every((input) => input.value === ''),
  );
  await page.locator('.page-head .icon-button').click();
  await button('退出登录').click();
  await page.locator('.uni-modal__btn_primary').click();
  await page.getByText('记录每一步建设', { exact: true }).waitFor();
  assert.equal(await page.locator('.login-input input').nth(0).inputValue(), '');
  assert.equal(await page.locator('.login-input input').nth(1).inputValue(), '');
  await page.locator('.login-input input').nth(0).fill('ui-worker');
  await page.locator('.login-input input').nth(1).fill('worker-test-pass');
  await button('登录').click();
  await page.getByText('现场工作台', { exact: true }).waitFor();
  assert.equal(await page.locator('.management-overview').count(), 0);
  await shot('11-工作人员工作台');
  await page.locator('uni-tabbar .uni-tabbar__label').filter({ hasText: '施工记录' }).click();
  await page.getByText('这里还没有施工记录', { exact: true }).waitFor();
  assert.equal(await page.getByText('T08 机位 · 基础施工区', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'H5 页面验收通过：身份登录与权限拦截、空白表单、图标居中、填报/离线补传、跨人员管理台账、真实统计图绘制、日期切换、台账搜索、项目照片、人员开通及多尺寸布局。',
  );
} catch (error) {
  await shot('failure');
  console.error('页面文字快照：', (await page.locator('body').innerText()).slice(0, 3500));
  console.error(
    '字体检查：',
    await page.evaluate(() =>
      [...document.querySelectorAll('uni-page-body,.screen,.login-screen,.page-title')].map(
        (node) => ({
          tag: node.tagName,
          class: node.className,
          family: getComputedStyle(node).fontFamily,
        }),
      ),
    ),
  );
  throw error;
} finally {
  await browser.close();
  await gateway.close();
  await service.close();
  web.closeAllConnections();
  await new Promise((resolve) => web.close(resolve));
}
