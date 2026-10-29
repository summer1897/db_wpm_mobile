import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestMobileService as createMobileService } from './account-fixture.mjs';
import { createMobileGateway } from '../server/gateway.mjs';
test('角色入口不能提权；管理台账跨人员只读，工作人员仅访问个人记录，项目照片受权限保护', async () => {
  const service = await createMobileService({
    root: await mkdtemp(join(tmpdir(), 'wind-role-ledger-')),
  });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const gateway = createMobileGateway({
    upstreamOrigin: `http://127.0.0.1:${service.server.address().port}`,
  });
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  const base = `http://127.0.0.1:${gateway.server.address().port}/api/mobile/v1`;
  async function call(path, value, token = '') {
    if (['/auth/register', '/users'].includes(path)) value = service.registrationFields(value);
    const response = await fetch(base + path, {
      method: value === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        'Content-Type': 'application/json',
      },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    assert.equal((await call('/admin/ledger')).status, 401);
    const registered = await call('/auth/register', {
      username: 'worker',
      password: '123456',
      role: 'worker',
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.data.user.role, 'worker');
    const admin = (
      await call('/auth/register', { username: '管理人员', password: '123456', role: 'admin' })
    ).data;
    assert.equal(
      (await call('/auth/login', { username: '管理人员', password: '123456', role: 'worker' }))
        .status,
      403,
    );
    const first = await call(
        '/users',
        { username: '甲', name: '张工', password: '123456' },
        admin.token,
      ),
      second = await call(
        '/users',
        { username: '乙', name: '李工', password: '123456', role: 'worker' },
        admin.token,
      );
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const worker = (
      await call('/auth/login', { username: '甲', password: '123456', role: 'worker' })
    ).data;
    const worker2 = (
      await call('/auth/login', { username: '乙', password: '123456', role: 'worker' })
    ).data;
    const escalation = await call('/auth/login', {
      username: '甲',
      password: '123456',
      role: 'admin',
    });
    assert.equal(escalation.status, 403);
    assert.equal(escalation.data.token, undefined);
    assert.equal((await call('/admin/ledger', undefined, worker.token)).status, 403);
    assert.equal(
      (
        await call(
          '/users',
          { username: '恶意提权', password: '123456', role: 'admin' },
          worker.token,
        )
      ).status,
      403,
    );
    const manager = await call(
      '/users',
      { username: '另一管理人员', password: '123456', role: 'admin' },
      admin.token,
    );
    assert.equal(manager.status, 201);
    assert.equal(manager.data.role, 'admin');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1eoAAAAASUVORK5CYII=',
      'base64',
    );
    const ids = [];
    for (const [index, person] of [admin, worker, worker2].entries()) {
      const id = randomUUID(),
        photoId = randomUUID(),
        type = ['foundation', 'transport', 'lifting'][index];
      const form = new FormData();
      form.append('file', new Blob([png]), '施工照片.png');
      const response = await fetch(base + '/photos', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + person.token,
          'X-File-Meta': encodeURIComponent(
            JSON.stringify({
              id: photoId,
              recordId: id,
              module: type,
              date: '2026-10-25',
              location: `T0${index + 1}`,
              name: '施工照片.png',
            }),
          ),
        },
        body: form,
      });
      assert.equal(response.status, 201);
      const photo = await response.json();
      const published = await call(
        '/reports',
        {
          id,
          type,
          date: '2026-10-25',
          location: `T0${index + 1}`,
          content: '完成施工检查与资料上传',
          photoIds: [photo.id],
        },
        person.token,
      );
      assert.equal(published.status, 201);
      ids.push({ id, photo: photo.id, serverId: published.data.serverId });
    }
    const result = await call('/admin/ledger', undefined, admin.token);
    assert.equal(result.status, 200);
    assert.equal(result.data.reports.length, 3);
    assert.equal(result.data.ledgerStatus, 'live');
    assert.equal(new Set(result.data.reports.map((row) => row.reporter.id)).size, 3);
    assert.ok(result.data.reports.every((row) => !Object.hasOwn(row.reporter, 'name')));
    assert.equal((await call('/reports', undefined, worker.token)).data.reports.length, 1);
    assert.equal((await call('/reports', undefined, admin.token)).data.reports.length, 1);
    assert.ok(!/passwordHash|cacheFile|salt|"token"/.test(JSON.stringify(result.data)));
    assert.equal(
      (
        await fetch(base + '/admin/photos/' + ids[1].photo, {
          headers: { Authorization: 'Bearer ' + worker.token },
        })
      ).status,
      403,
    );
    const image = await fetch(base + '/admin/photos/' + ids[1].photo, {
      headers: { Authorization: 'Bearer ' + admin.token },
    });
    assert.equal(image.status, 200);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    assert.equal(
      (
        await fetch(base + '/photos/' + ids[1].photo, {
          headers: { Authorization: 'Bearer ' + admin.token },
        })
      ).status,
      404,
    );
    await service.domain.store.transaction((data) => {
      data.logs.find((row) => row.id === ids[1].serverId).reviewStatus = '退回修改';
      data.logs.find((row) => row.id === ids[2].serverId).archived = true;
    });
    const latest = (await call('/admin/ledger', undefined, admin.token)).data;
    assert.equal(latest.reports.length, 2);
    assert.equal(latest.reports.find((row) => row.id === ids[1].id).reviewStatus, '退回修改');
    assert.equal(
      (
        await fetch(base + '/admin/photos/' + ids[2].photo, {
          headers: { Authorization: 'Bearer ' + admin.token },
        })
      ).status,
      404,
    );
    assert.equal((await call('/admin/ledger', {}, admin.token)).status, 404);
  } finally {
    await gateway.close();
    await service.close();
  }
});
