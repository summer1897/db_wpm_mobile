/** 所有账号/照片/资料均在临时目录；验证正式同步链路，不向用户的真实项目写入测试记录。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createConstructionServer } from '../../server/api.mjs';
import { createTestMobileService as createMobileService } from './account-fixture.mjs';
import { createMobileGateway } from '../server/gateway.mjs';
test('双角色注册、同台账同步、原件归档、审核回传、重启幂等及跨账号隔离', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wind-desktop-sync-'));
  const desktopRoot = join(root, 'dashboard'),
    mobileRoot = join(root, 'mobile');
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const origin = `http://127.0.0.1:${port}`;
  let desktop, app, gateway, base;
  async function startMobile() {
    app = await createMobileService({ root: mobileRoot, desktopRoot, desktopOrigin: origin });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    gateway = createMobileGateway({
      upstreamOrigin: `http://127.0.0.1:${app.server.address().port}`,
    });
    gateway.server.listen(0, '127.0.0.1');
    await once(gateway.server, 'listening');
    base = `http://127.0.0.1:${gateway.server.address().port}/api/mobile/v1`;
  }
  async function call(path, value, token = '') {
    if (['/auth/register', '/users'].includes(path)) value = app.registrationFields(value);
    const response = await fetch(base + path, {
      method: value === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    return { status: response.status, data: await response.json() };
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1eoAAAAASUVORK5CYII=',
    'base64',
  );
  const id = randomUUID(),
    photoId = randomUUID();
  const fields = {
    id,
    type: 'foundation',
    date: '2026-10-25',
    location: 'T08基础',
    content: '检查基础施工并归档现场照片',
  };
  async function upload(token) {
    const form = new FormData();
    form.append('file', new Blob([png]), '现场.png');
    return fetch(base + '/photos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'X-File-Meta': encodeURIComponent(
          JSON.stringify({
            id: photoId,
            recordId: id,
            module: fields.type,
            date: fields.date,
            location: fields.location,
            name: '现场.png',
          }),
        ),
      },
      body: form,
    });
  }
  try {
    await startMobile();
    const initial = (await call('/config')).data;
    assert.equal(initial.integration, 'desktop');
    assert.equal(initial.syncStatus, 'unavailable');
    const worker = await call('/auth/register', {
      username: 'worker',
      password: '123456',
      role: 'worker',
      name: '不应采用的姓名',
    });
    assert.equal(worker.status, 201);
    assert.equal(worker.data.user.name, '工作人员');
    const admin = await call('/auth/register', {
      username: 'manager',
      password: '123456',
      role: 'admin',
    });
    assert.equal(admin.status, 201);
    assert.equal(
      (await call('/auth/register', { username: 'worker', password: '123456', role: 'admin' }))
        .status,
      409,
    );
    assert.equal(
      (await call('/auth/register', { username: 'invalid', password: '123456', role: 'superuser' }))
        .status,
      400,
    );
    assert.equal(
      (await call('/auth/login', { username: 'missing', password: '123456' })).data.error,
      '账号尚未注册，请先注册',
    );
    assert.equal((await upload(worker.data.token)).status, 503, '未连接桌面时不能误报已提交');
    desktop = await createConstructionServer({ root: desktopRoot, mobileIntegration: true });
    desktop.server.listen(port, '127.0.0.1');
    await once(desktop.server, 'listening');
    const config = (await call('/config')).data;
    assert.equal(config.syncStatus, 'ready');
    assert.equal(config.scope, initial.scope);
    assert.equal((await fetch(origin + '/api/construction')).status, 401, '原桌面管理接口仍需登录');
    const secret = JSON.parse(
      await readFile(join(desktopRoot, 'private/mobile-sync.json'), 'utf8'),
    );
    assert.equal(
      (
        await fetch(origin + '/api/construction', {
          headers: { 'X-Wind-Upload-Token': secret.token },
        })
      ).status,
      401,
    );
    desktop.fieldGateway.server.listen(0, '127.0.0.1');
    await once(desktop.fieldGateway.server, 'listening');
    assert.equal(
      (
        await fetch(
          `http://127.0.0.1:${desktop.fieldGateway.server.address().port}/api/construction/intake`,
          { headers: { 'X-Wind-Upload-Token': secret.token } },
        )
      ).status,
      403,
      '私有同步密钥不能用于公开上传网关',
    );
    const image = await upload(worker.data.token);
    assert.equal(image.status, 201);
    const photo = await image.json();
    const saved = await call('/reports', { ...fields, photoIds: [photo.id] }, worker.data.token);
    assert.equal(saved.status, 201);
    assert.equal(desktop.store.data.logs.length, 1);
    assert.equal(app.domain.store.data.logs.length, 0, '正式资料不能留在隔离试用台账');
    assert.equal(desktop.store.data.logs[0].id, saved.data.serverId);
    assert.equal(desktop.store.data.logs[0].workSource, 'workDynamics');
    assert.equal(desktop.store.data.logs[0].reporter, '移动端填报');
    assert.equal(desktop.store.data.materials.length, 1);
    const auth = await fetch(origin + '/api/construction/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'desktop-test',
        password: '123456',
        confirmPassword: '123456',
      }),
    });
    assert.equal(auth.status, 201);
    const headers = { Cookie: auth.headers.get('set-cookie').split(';')[0] };
    const snapshot = await fetch(origin + '/api/construction', { headers }).then((r) => r.json());
    assert.equal(snapshot.logs[0].id, saved.data.serverId, '电脑端接口实际读取到移动端提交记录');
    const original = await fetch(origin + '/api/construction/files/' + photo.id, { headers });
    assert.equal(original.status, 200);
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
    assert.deepEqual(
      await fetch(origin + '/api/construction/intake-links', { headers }).then((r) => r.json()),
      [],
    );
    const ledger = (await call('/admin/ledger', undefined, admin.data.token)).data;
    assert.equal(ledger.reports[0].content, fields.content);
    assert.equal(ledger.reports[0].reporter.name, undefined);
    const other = (
      await call('/auth/register', { username: 'worker2', password: '123456', role: 'worker' })
    ).data;
    assert.equal((await call('/reports', undefined, other.token)).data.reports.length, 0);
    assert.equal((await call('/admin/ledger', undefined, other.token)).status, 403);
    assert.equal(
      (
        await fetch(base + '/photos/' + photo.id, {
          headers: { Authorization: 'Bearer ' + other.token },
        })
      ).status,
      404,
    );
    await desktop.store.transaction((data) => {
      data.logs[0].reviewStatus = '退回修改';
      data.logs[0].content = '电脑端修订说明';
    });
    assert.equal(
      (await call('/reports', undefined, worker.data.token)).data.reports[0].content,
      '电脑端修订说明',
    );
    assert.equal(
      (await call('/admin/ledger', undefined, admin.data.token)).data.reports[0].reviewStatus,
      '退回修改',
    );
    await gateway.close();
    await app.close();
    await startMobile();
    assert.equal((await call('/config')).data.scope, config.scope);
    const again = (await call('/auth/login', { username: 'worker', password: '123456' })).data;
    assert.equal(
      (await call('/reports', { ...fields, photoIds: [photo.id] }, again.token)).status,
      200,
    );
    assert.equal(desktop.store.data.logs.length, 1, '重启重试不重复发布');
    desktop.fieldGateway.server.closeAllConnections();
    await new Promise((done) => desktop.fieldGateway.server.close(done));
    desktop.server.closeAllConnections();
    await new Promise((done) => desktop.server.close(done));
    await desktop.store.queue;
    desktop = await createConstructionServer({ root: desktopRoot, mobileIntegration: true });
    desktop.server.listen(port, '127.0.0.1');
    await once(desktop.server, 'listening');
    assert.equal((await call('/config')).data.scope, config.scope, '电脑端重启也不更换通道');
    assert.equal((await call('/config')).data.syncStatus, 'ready');
    const restored = JSON.parse(
      await readFile(join(desktopRoot, 'private/mobile-sync.json'), 'utf8'),
    );
    assert.equal(restored.token, secret.token, '重启沿用内部密钥，不再需要每天更换链接');
    assert.ok(!/token|ledgerRoot|passwordHash|不应采用的姓名/.test(JSON.stringify(ledger)));
    await desktop.store.transaction((data) => {
      data.logs[0].archived = true;
    });
    assert.deepEqual((await call('/reports', undefined, again.token)).data.deletedIds, [id]);
  } finally {
    await gateway?.close();
    await app?.close();
    if (desktop) {
      desktop.fieldGateway.server.closeAllConnections();
      if (desktop.fieldGateway.server.listening)
        await new Promise((done) => desktop.fieldGateway.server.close(done));
      desktop.server.closeAllConnections();
      if (desktop.server.listening) await new Promise((done) => desktop.server.close(done));
    }
  }
});
