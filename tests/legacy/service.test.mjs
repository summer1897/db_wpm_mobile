import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createTestMobileService as createMobileService } from './account-fixture.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1eoAAAAASUVORK5CYII=',
  'base64',
);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wind-mobile-test-'));
  const app = await createMobileService({ root });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}/api/mobile/v1`;
  const call = async (path, value, token = '', headers = {}) => {
    if (['/auth/register', '/users'].includes(path)) value = app.registrationFields(value);
    const response = await fetch(base + path, {
      method: value === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(value ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const registered = await call('/auth/register', {
    username: '项目管理员',
    password: '123456',
    role: 'admin',
  });
  assert.equal(registered.status, 201);
  return { ...app, root, base, call, admin: registered.data };
}
test('账号、权限、真实归档、重复提交和审核联动闭环', async () => {
  const app = await fixture();
  try {
    const { token } = app.admin;
    assert.equal((await app.call('/config')).data.mode, 'trial');
    assert.equal((await app.call('/reports')).status, 401);
    assert.equal(
      (
        await app.call('/auth/register', {
          username: 'extra',
          password: '123456',
          role: 'worker',
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await app.call('/auth/login', {
          username: '项目管理员',
          password: 'wrong',
        })
      ).status,
      401,
    );
    const first = await app.call(
      '/users',
      { username: 'worker1', password: '123456', name: '张工' },
      token,
    );
    assert.equal(first.status, 201);
    assert.equal(first.data.role, 'worker');
    const login = await app.call('/auth/login', {
      username: 'worker1',
      password: '123456',
    });
    const workerToken = login.data.token;
    assert.equal(
      (await app.call('/users', { username: 'worker2', password: '123456' }, workerToken)).status,
      403,
    );
    assert.equal(
      (
        await app.call('/reports', undefined, token, {
          Origin: 'https://untrusted.example',
        })
      ).status,
      403,
    );
    const id = randomUUID();
    const photoId = randomUUID();
    const fields = {
      id,
      type: 'transport',
      date: '2026-10-23',
      location: 'T2进场道路',
      content: '叶片运输车辆完成进场检查',
    };
    assert.equal(
      (await app.call('/reports', { ...fields, photoIds: [] }, workerToken)).status,
      400,
    );
    const metadata = {
      id: photoId,
      recordId: id,
      module: fields.type,
      date: fields.date,
      location: fields.location,
      name: '现场照片.png',
      description: fields.content,
    };
    const upload = async () => {
      const response = await fetch(app.base + '/photos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${workerToken}`,
          'Content-Type': 'application/octet-stream',
          'X-File-Meta': encodeURIComponent(JSON.stringify(metadata)),
        },
        body: png,
      });
      return { status: response.status, data: await response.json() };
    };
    const photo = await upload();
    assert.equal(photo.status, 201, JSON.stringify(photo));
    const again = await upload();
    assert.equal(again.data.id, photo.data.id);
    const input = { ...fields, photoIds: [photo.data.id] };
    assert.equal(
      (await app.call('/reports', input, token)).status,
      400,
      '管理员不能冒用其他人员的附件',
    );
    const [one, two] = await Promise.all([
      app.call('/reports', input, workerToken),
      app.call('/reports', input, workerToken),
    ]);
    assert.ok([200, 201].includes(one.status), JSON.stringify(one));
    assert.equal(one.data.serverId, two.data.serverId);
    assert.equal(app.domain.store.data.logs.length, 1);
    const record = app.domain.store.data.logs[0];
    assert.equal(record.reviewStatus, '已审核');
    assert.equal(record.module, 'transport');
    assert.equal(record.workSource, 'workDynamics');
    assert.equal(record.reporter, '移动端填报');
    const material = app.domain.store.data.materials[0];
    assert.equal(material.staged, false);
    assert.match(material.storagePath, /近期工作动态图片\/风机运输/);
    assert.equal((await app.call('/reports', undefined, workerToken)).data.reports.length, 1);
    assert.equal((await app.call('/reports', undefined, token)).data.reports.length, 0);
    await app.domain.store.transaction((data) => {
      data.logs[0].reviewStatus = '退回修改';
    });
    assert.equal(
      (await app.call('/reports', undefined, workerToken)).data.reports[0].reviewStatus,
      '退回修改',
    );
    await app.domain.store.transaction((data) => {
      data.logs[0].archived = true;
    });
    const deleted = (await app.call('/reports', undefined, workerToken)).data;
    assert.equal(deleted.reports.length, 0);
    assert.deepEqual(deleted.deletedIds, [id]);
    const privateFile = await readFile(join(app.root, 'private', 'mobile-state.json'), 'utf8');
    assert.equal(privateFile.includes('"password":'), false);
    assert.equal(privateFile.includes('123456'), false);
    await app.call('/auth/logout', {}, workerToken);
    assert.equal((await app.call('/reports', undefined, workerToken)).status, 401);
  } finally {
    await app.close();
  }
});
test('记录与照片必须一致，拒绝无效日期和跨域预检', async () => {
  const app = await fixture();
  try {
    const bad = await app.call(
      '/reports',
      {
        id: randomUUID(),
        type: 'lifting',
        date: '2026-02-30',
        location: 'T3',
        content: '施工',
        photoIds: [],
      },
      app.admin.token,
    );
    assert.equal(bad.status, 400);
    const res = await fetch(app.base + '/config', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.has('access-control-allow-origin'), false);
    const response = await fetch(app.base + '/config', {
      method: 'OPTIONS',
      headers: { Origin: 'capacitor://localhost' },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  } finally {
    await app.close();
  }
});
